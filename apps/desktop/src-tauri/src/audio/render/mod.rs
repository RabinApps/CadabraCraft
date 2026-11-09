//! Rendering one chapter or a sample: validation, synthesis, encoding and the atomic write under `exports/`.
use super::batch::Chunk;
use super::encode;
use super::engine::synthesize;
use super::error::{other, AudioError};
use super::loudness::{self, LoudnessReport};
use super::wav::write_wav;
use crate::project::{self, ProjectError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRequest {
    /// One id per audiobook export; `audio_cancel` with it stops this chapter and every later one.
    pub job_id: String,
    pub root: String,
    /// Output path without extension, for example `exports/audio/01-the-quay`.
    pub base: String,
    pub chunks: Vec<Chunk>,
    pub voice: String,
    pub speed: f64,
    pub formats: Vec<String>,
    /// Also keep a lossless FLAC of this chapter here (`.cadabra/audio/parts/<name>.flac`) for the M4B, which is built
    /// from the parts of all chapters. Not an export: it is never listed in `files`.
    #[serde(default)]
    pub part: Option<String>,
    /// The edition's language (a BCP 47 tag), written into the chapter files that can carry it (Opus `LANGUAGE`).
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SampleRequest {
    /// Stops this sample with `audio_cancel`.
    pub job_id: String,
    pub chunks: Vec<Chunk>,
    pub voice: String,
    pub speed: f64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct RenderedFile {
    pub format: String,
    pub path: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenderedChapter {
    pub files: Vec<RenderedFile>,
    pub duration_sec: f64,
    /// The part written for the M4B, when one was asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    /// The loudness of the chapter as written (measured, not changed): integrated LUFS, true peak and the pass check.
    pub loudness: LoudnessReport,
}

/// Most bytes of one transcript file (a long novel is a few hundred kilobytes of text).
const TRANSCRIPT_MAX_BYTES: usize = 32 * 1024 * 1024;

/// Whether `rel` is a transcript the audiobook may write: `exports/**/audio/<name>.txt` or `.vtt`, a plain file name.
pub fn is_transcript_path(rel: &str) -> bool {
    let Some((dir, name)) = rel.rsplit_once('/') else { return false };
    let stem = name.strip_suffix(".txt").or_else(|| name.strip_suffix(".vtt"));
    rel.starts_with("exports/")
        && (dir.ends_with("/audio") || dir == "exports/audio")
        && stem.is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !s.starts_with('.'))
}

/// Writes a transcript (the text the voice was given) next to the audio, atomically (temp file and rename). Only the text
/// formats of `is_transcript_path` are accepted, so this cannot be used to rewrite anything else under `exports/`.
pub fn write_transcript(root: &Path, rel: &str, contents: &str) -> Result<(), AudioError> {
    if !is_transcript_path(rel) {
        return Err(AudioError::from(ProjectError::UnsafePath { path: rel.to_string() }));
    }
    if contents.len() > TRANSCRIPT_MAX_BYTES {
        return Err(other("the transcript is too large to save"));
    }
    project::write_bytes(root, rel, contents.as_bytes())?;
    Ok(())
}

/// Formats this build can write. There is no MP3 on purpose (see docs/architecture.md, "Audio encoders").
/// Most characters and chunks one chapter request may carry (a long novel chapter is well under a million characters).
const CHAPTER_MAX_CHARS: usize = 2_000_000;
const CHAPTER_MAX_CHUNKS: usize = 200_000;

const WRITABLE: &[&str] = &["wav", "flac", "opus"];

fn check_request(req: &ChapterRequest) -> Result<(), AudioError> {
    if req.chunks.iter().all(|c| c.text.trim().is_empty()) {
        return Err(other("there is nothing to read aloud in this chapter"));
    }
    if !(0.5..=2.0).contains(&req.speed) {
        return Err(other("speed must be between 0.5 and 2"));
    }
    if req.chunks.len() > CHAPTER_MAX_CHUNKS || req.chunks.iter().map(|c| c.text.len()).sum::<usize>() > CHAPTER_MAX_CHARS {
        return Err(other("this chapter is too long to read aloud in one piece; split it"));
    }
    if req.formats.is_empty() && req.part.is_none() {
        return Err(other("choose at least one audio format"));
    }
    if let Some(part) = &req.part {
        if !project::is_audio_part(part) {
            return Err(AudioError::from(ProjectError::UnsafePath { path: part.clone() }));
        }
    }
    for f in &req.formats {
        if !WRITABLE.contains(&f.as_str()) {
            return Err(other(format!("unknown audio format {f:?}; choose WAV, FLAC or Opus")));
        }
    }
    if !req.base.starts_with("exports/") || req.base.ends_with('/') {
        return Err(AudioError::from(ProjectError::UnsafePath { path: req.base.clone() }));
    }
    Ok(())
}

/// Most characters a sample may read: a few sentences, never a chapter.
const SAMPLE_MAX_CHARS: usize = 1200;

/// A short WAV of the given text for "Hear a sample". Nothing touches the project: the engine writes to a temp dir
/// that is removed on every path and the bytes are returned.
pub fn render_sample(req: &SampleRequest, sherpa: &Path, voices: Option<&Path>, cancel: &AtomicBool) -> Result<Vec<u8>, AudioError> {
    if req.chunks.iter().all(|c| c.text.trim().is_empty()) {
        return Err(other("there is nothing to read aloud in this chapter"));
    }
    if !(0.5..=2.0).contains(&req.speed) {
        return Err(other("speed must be between 0.5 and 2"));
    }
    if req.chunks.iter().map(|c| c.text.len()).sum::<usize>() > SAMPLE_MAX_CHARS {
        return Err(other("a sample is limited to a few sentences"));
    }
    let (samples, rate) = synthesize(&req.chunks, &req.voice, req.speed, sherpa, voices, cancel, &|_| {})?;
    write_wav(rate, &samples).map_err(|message| AudioError::Synth { message })
}

/// Renders one chapter. `progress` receives 0..1 after every batch. Everything is validated before the engine runs,
/// and nothing is written unless the whole chapter rendered.
pub fn render_chapter(
    req: &ChapterRequest,
    sherpa: &Path,
    voices: Option<&Path>,
    cancel: &AtomicBool,
    progress: &dyn Fn(f64),
) -> Result<RenderedChapter, AudioError> {
    check_request(req)?;
    let root = project::require_project(&PathBuf::from(&req.root))?;
    for f in &req.formats {
        project::resolve(&root, &format!("{}.{f}", req.base))?;
    }
    if let Some(part) = &req.part {
        project::resolve(&root, part)?;
    }
    let (samples, rate) = synthesize(&req.chunks, &req.voice, req.speed, sherpa, voices, cancel, progress)?;
    write_outputs(req, &root, rate, &samples, cancel)
}

/// Encodes the rendered samples into every requested format and the part, writing each file atomically under the project.
/// The cancel flag is checked before each file, so a Cancel between two encodes stops the rest (earlier files stay).
fn write_outputs(req: &ChapterRequest, root: &Path, rate: u32, samples: &[i16], cancel: &AtomicBool) -> Result<RenderedChapter, AudioError> {
    let mut files = Vec::new();
    for f in &req.formats {
        if cancel.load(Ordering::Relaxed) {
            return Err(AudioError::Cancelled);
        }
        let encoded = match f.as_str() {
            "wav" => write_wav(rate, samples),
            "flac" => encode::encode_flac(rate, samples),
            _ => encode::encode_opus(rate, samples, req.language.as_deref()),
        };
        let bytes = encoded.map_err(|message| AudioError::Encode { format: f.clone(), message })?;
        let path = format!("{}.{f}", req.base);
        project::write_bytes(root, &path, &bytes)?;
        files.push(RenderedFile { format: f.clone(), path });
    }
    if let Some(part) = &req.part {
        if cancel.load(Ordering::Relaxed) {
            return Err(AudioError::Cancelled);
        }
        let bytes = encode::encode_flac(rate, samples).map_err(|message| AudioError::Encode { format: "flac".into(), message })?;
        project::write_audio_part(root, part, &bytes)?;
    }
    let loudness = loudness::measure(rate, samples);
    Ok(RenderedChapter { files, duration_sec: samples.len() as f64 / rate as f64, part: req.part.clone(), loudness })
}

#[cfg(test)]
mod tests;

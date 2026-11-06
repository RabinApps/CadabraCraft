//! The M4B: one MP4 audiobook for the whole book, with a chapter list, the cover and tags. The audio is the lossless parts
//! the chapter renders left under `.cadabra/audio/parts/`; ffmpeg (an LGPL-only build, run as a separate program) joins
//! them and encodes AAC. Everything but the process is plain data: the chapter metadata and the file list are built here
//! and checked in tests; the process rules (no shell, timeout, cancel, temp dir removed) come from `platform::sidecar`.
use super::engine::run_ffmpeg;
use super::error::{other, AudioError};
use crate::project::{self, ProjectError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

/// A book has at most a few hundred chapters; this stops a request from building an enormous list.
const MAX_CHAPTERS: usize = 10_000;

/// Largest M4B built, in bytes (about 70 hours at 64 kbit/s). The file is streamed into the project, so it is never held in memory.
const MAX_M4B_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Joining and encoding a long book takes a few minutes at most; anything longer is stuck.
const TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// Mono speech: transparent enough for narration and about 29 MB per hour.
const AAC_BITRATE: &str = "64k";

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct M4bChapter {
    pub title: String,
    /// `.cadabra/audio/parts/<name>.flac`, as written by `render_chapter`.
    pub part: String,
    pub duration_sec: f64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct M4bRequest {
    /// Stops the build with `audio_cancel`.
    pub job_id: String,
    pub root: String,
    /// Output path without extension, for example `exports/audio/my-book`.
    pub base: String,
    pub title: String,
    pub author: String,
    /// `assets/<name>.png|jpg|jpeg`; none means no cover.
    pub cover: Option<String>,
    pub chapters: Vec<M4bChapter>,
    /// The edition's language (a BCP 47 tag such as `fr` or `pt-BR`); written as the audio track's language so players
    /// pick the right voice and hyphenation. Missing or malformed means "undetermined".
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltM4b {
    pub path: String,
    pub duration_sec: f64,
}

/// A part name is a plain file name in the parts folder; the file list handed to ffmpeg then needs no escaping.
fn part_name(part: &str) -> Result<&str, AudioError> {
    let name = part.strip_prefix(project::AUDIO_PARTS_DIR).filter(|_| project::is_audio_part(part));
    name.filter(|n| n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
        .ok_or_else(|| AudioError::from(ProjectError::UnsafePath { path: part.to_string() }))
}

/// A BCP 47 tag as it may be written into a tag value: letters, digits and hyphens only, so nothing odd reaches a file.
pub fn clean_language(tag: Option<&str>) -> Option<String> {
    let t = tag?.trim();
    (!t.is_empty() && t.len() <= 35 && t.split('-').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric()))).then(|| t.to_string())
}

/// The three-letter ISO 639-2 code an MP4 track language holds, from a BCP 47 tag (`pt-BR` is `por`). Three-letter
/// primary subtags pass through; anything unknown is `und` (undetermined), which players treat as "not set".
pub fn iso639_2(tag: Option<&str>) -> String {
    let primary = clean_language(tag).map(|t| t.split('-').next().unwrap_or("").to_ascii_lowercase()).unwrap_or_default();
    let three = match primary.as_str() {
        "en" => "eng",
        "fr" => "fra",
        "de" => "deu",
        "es" => "spa",
        "it" => "ita",
        "pt" => "por",
        "nl" => "nld",
        "sv" => "swe",
        "da" => "dan",
        "no" | "nb" | "nn" => "nor",
        "fi" => "fin",
        "pl" => "pol",
        "cs" => "ces",
        "sk" => "slk",
        "sl" => "slv",
        "hu" => "hun",
        "ro" => "ron",
        "bg" => "bul",
        "hr" => "hrv",
        "sr" => "srp",
        "ru" => "rus",
        "uk" => "ukr",
        "el" => "ell",
        "tr" => "tur",
        "ar" => "ara",
        "he" => "heb",
        "fa" => "fas",
        "hi" => "hin",
        "ja" => "jpn",
        "ko" => "kor",
        "zh" => "zho",
        "id" => "ind",
        "vi" => "vie",
        "th" => "tha",
        "ca" => "cat",
        "la" => "lat",
        "et" => "est",
        "lv" => "lav",
        "lt" => "lit",
        other if other.len() == 3 && other.chars().all(|c| c.is_ascii_lowercase()) => other,
        _ => "und",
    };
    three.to_string()
}

fn is_cover_ext(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg"].iter().any(|e| lower.ends_with(e))
}

/// One value of an ffmetadata file: `=`, `;`, `#`, `\` and line breaks are escaped with a backslash.
fn meta_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '=' | ';' | '#' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '\n' | '\r' => out.push_str("\\\n"),
            c => out.push(c),
        }
    }
    out
}

/// The ffmetadata file: book tags, then one `[CHAPTER]` per chapter in milliseconds, back to back.
pub fn ffmetadata(title: &str, author: &str, chapters: &[M4bChapter]) -> String {
    let mut out = format!(";FFMETADATA1\ntitle={}\nartist={}\nalbum={}\ngenre=Audiobook\n", meta_escape(title), meta_escape(author), meta_escape(title));
    let mut start = 0u64;
    for c in chapters {
        let end = start.saturating_add((c.duration_sec.max(0.0) * 1000.0).round() as u64);
        out.push_str(&format!("[CHAPTER]\nTIMEBASE=1/1000\nSTART={start}\nEND={end}\ntitle={}\n", meta_escape(&c.title)));
        start = end;
    }
    out
}

/// On Windows the separators become `/`, which ffmpeg accepts and which keeps backslashes out of the list file.
fn forward_slashes(path: &str, windows: bool) -> String {
    if windows {
        path.replace('\\', "/")
    } else {
        path.to_string()
    }
}

/// The concat demuxer's list: one `file` line per part, in order, with absolute paths (the demuxer resolves relative
/// ones against the list's own folder). A single quote in a path is written as `'\''`; on Windows the separators become
/// `/`, which ffmpeg accepts and which keeps backslashes out of the file.
pub fn concat_list(paths: &[PathBuf]) -> String {
    paths.iter().map(|p| format!("file '{}'\n", forward_slashes(&p.to_string_lossy(), cfg!(windows)).replace('\'', "'\\''"))).collect()
}

/// ffmpeg's arguments (`-safe 0` because the part paths are absolute). Input 0 is the part list, input 1 the metadata and, with a cover, input 2 the picture (kept as an
/// attached picture, not re-encoded).
pub fn ffmpeg_args(list: &Path, meta: &Path, cover: Option<&Path>, language: Option<&str>, out: &Path) -> Vec<String> {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    // Each input may only be opened as a plain file (or pipe): a crafted list or picture can then not make ffmpeg
    // read a URL or another protocol.
    let wl = ["-protocol_whitelist", "file,pipe"].map(String::from);
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0"].map(String::from).into();
    a.extend(wl.clone());
    a.extend(["-i".into(), s(list)]);
    a.extend(wl.clone());
    a.extend(["-i".into(), s(meta)]);
    if let Some(c) = cover {
        a.extend(wl);
        a.extend(["-i".into(), s(c)]);
    }
    a.extend(["-map", "0:a"].map(String::from));
    if cover.is_some() {
        a.extend(["-map", "2:v"].map(String::from));
    }
    a.extend(["-map_metadata", "1", "-map_chapters", "1", "-c:a", "aac", "-b:a", AAC_BITRATE].map(String::from));
    // The track's language (mdhd) is what players read to pick the voice and language; it is a stream tag, not a global one.
    a.extend(["-metadata:s:a:0".to_string(), format!("language={}", iso639_2(language))]);
    if cover.is_some() {
        a.extend(["-c:v", "copy", "-disposition:v:0", "attached_pic"].map(String::from));
    }
    a.extend(["-f", "ipod"].map(String::from));
    a.push(s(out));
    a
}

fn check(req: &M4bRequest) -> Result<(), AudioError> {
    if req.chapters.is_empty() {
        return Err(other("there are no chapters to put in the audiobook"));
    }
    if req.chapters.len() > MAX_CHAPTERS {
        return Err(other("there are too many chapters for one audiobook"));
    }
    if !req.base.starts_with("exports/") || req.base.ends_with('/') {
        return Err(AudioError::from(ProjectError::UnsafePath { path: req.base.clone() }));
    }
    if let Some(c) = &req.cover {
        if !c.starts_with("assets/") || !is_cover_ext(c) {
            return Err(AudioError::from(ProjectError::NotImageAsset { path: c.clone() }));
        }
    }
    req.chapters.iter().try_for_each(|c| part_name(&c.part).map(|_| ()))
}

/// Builds `<base>.m4b` from the parts. Nothing is written unless ffmpeg succeeded; the temp dir (list, metadata, output)
/// is removed on every path.
pub fn build_m4b(req: &M4bRequest, ffmpeg: &Path, cancel: &AtomicBool) -> Result<BuiltM4b, AudioError> {
    check(req)?;
    let root = project::require_project(&PathBuf::from(&req.root))?;
    let path = format!("{}.m4b", req.base);
    project::resolve(&root, &path)?;
    for c in &req.chapters {
        let part = project::resolve(&root, &c.part)?;
        if !part.symlink_metadata().is_ok_and(|m| m.is_file()) {
            return Err(other(format!("the audio for {:?} is missing; render the chapters again", c.title)));
        }
    }
    let cover = req.cover.as_deref().map(|c| project::resolve(&root, c)).transpose()?;
    if cover.as_ref().is_some_and(|c| !c.symlink_metadata().is_ok_and(|m| m.is_file())) {
        return Err(AudioError::from(ProjectError::NotImageAsset { path: req.cover.clone().unwrap_or_default() }));
    }
    if let Some(rel) = &req.cover {
        // The picture goes to ffmpeg untouched, so it must really be a PNG or JPEG of a sane size.
        let bytes = project::read_asset(&root, rel)?;
        let ext = project::image_ext(rel).ok_or_else(|| ProjectError::NotImageAsset { path: rel.clone() })?;
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg") {
            return Err(AudioError::from(ProjectError::NotImageAsset { path: rel.clone() }));
        }
        project::check_image(rel, &ext, &bytes)?;
    }
    let parts: Vec<PathBuf> = req.chapters.iter().map(|c| project::resolve(&root, &c.part)).collect::<Result<_, _>>()?;
    let scratch = tempfile::Builder::new().prefix("cadabracraft-m4b-").tempdir().map_err(other)?;
    let (list, meta, out) = (scratch.path().join("parts.txt"), scratch.path().join("book.ffmeta"), scratch.path().join("book.m4b"));
    fs::write(&list, concat_list(&parts)).map_err(other)?;
    fs::write(&meta, ffmetadata(&req.title, &req.author, &req.chapters)).map_err(other)?;
    let r = run_ffmpeg(ffmpeg, &ffmpeg_args(&list, &meta, cover.as_deref(), req.language.as_deref(), &out), scratch.path(), TIMEOUT, cancel)?;
    if !r.success || !out.is_file() {
        let msg = r.stderr.trim();
        let message = if msg.is_empty() {
            "the encoder exited with an error and no message".to_string()
        } else {
            msg.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect()
        };
        return Err(AudioError::Encode { format: "m4b".into(), message });
    }
    // The encoder's output is streamed into the project, never held in memory; the cap stops a runaway encode filling the disk.
    store_encoded(&root, &path, &out, MAX_M4B_BYTES)?;
    Ok(BuiltM4b { path, duration_sec: req.chapters.iter().map(|c| c.duration_sec.max(0.0)).sum() })
}

/// Copies the encoder's output (a regular file of at most `cap` bytes) to `rel` under `exports/`, atomically, in chunks.
fn store_encoded(root: &Path, rel: &str, out: &Path, cap: u64) -> Result<u64, AudioError> {
    let too_large = || ProjectError::TooLarge { path: "book.m4b".into(), max_mb: cap / 1024 / 1024 };
    Ok(project::write_bytes_from_file(root, rel, out, cap, "book.m4b", &too_large)?)
}

#[cfg(test)]
mod tests;

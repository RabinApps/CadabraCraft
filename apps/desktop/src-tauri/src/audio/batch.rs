//! Grouping text chunks into engine calls and building the engine's command line.
use super::voices::{Engine, VoiceDef};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Pauses of at least this long (headings, scene breaks) always end a batch, so they are never shortened.
const HARD_PAUSE_MS: u32 = 1000;
/// Paragraph pauses end a batch only once it has this many characters; inside a batch the engine's own sentence
/// silence is used. Starting a process costs about a second, so batches must not be tiny.
const MIN_BATCH_CHARS: usize = 1200;
const MAX_BATCH_CHARS: usize = 2500;
const PARAGRAPH_MS: u32 = 600;
/// Longest pause the renderer will insert, so a hostile or buggy request cannot ask for hours of silence.
pub(crate) const MAX_PAUSE_MS: u32 = 10_000;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub text: String,
    pub pause_after_ms: u32,
}

#[derive(Debug, PartialEq)]
pub(crate) struct Batch {
    pub(crate) text: String,
    pub(crate) pause_after_ms: u32,
}

/// Groups chunks into engine calls. A heading or scene-break pause always ends a batch; a paragraph pause ends one
/// once it is big enough to be worth a process start; no batch grows past `MAX_BATCH_CHARS`.
pub(crate) fn plan_batches(chunks: &[Chunk]) -> Vec<Batch> {
    let mut out = Vec::new();
    let (mut text, mut pause) = (String::new(), 0);
    for c in chunks {
        let t = c.text.replace(['\n', '\r'], " ").trim().to_string();
        if t.is_empty() {
            continue;
        }
        if !text.is_empty() && text.len() + 1 + t.len() > MAX_BATCH_CHARS {
            out.push(Batch { text: std::mem::take(&mut text), pause_after_ms: pause });
        }
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(&t);
        pause = c.pause_after_ms.min(MAX_PAUSE_MS);
        if pause >= HARD_PAUSE_MS || (pause >= PARAGRAPH_MS && text.len() >= MIN_BATCH_CHARS) {
            out.push(Batch { text: std::mem::take(&mut text), pause_after_ms: pause });
        }
    }
    if !text.is_empty() {
        out.push(Batch { text, pause_after_ms: pause });
    }
    // The engine reads a leading "-" as one of its own options.
    for b in &mut out {
        b.text = b.text.trim_start_matches('-').trim_start().to_string();
    }
    out.retain(|b| !b.text.is_empty());
    out
}

pub(crate) fn engine_args(v: &VoiceDef, root: &Path, speed: f64, threads: usize, out: &Path, text: &str) -> Vec<String> {
    let dir = root.join(v.dir);
    let p = |x: PathBuf| x.to_string_lossy().into_owned();
    let scale = format!("{:.4}", 1.0 / speed);
    let mut a = match v.engine {
        Engine::Kokoro => vec![
            format!("--kokoro-model={}", p(dir.join(v.model))),
            format!("--kokoro-voices={}", p(dir.join("voices.bin"))),
            format!("--kokoro-tokens={}", p(dir.join("tokens.txt"))),
            format!("--kokoro-lexicon={}", p(root.join(v.lexicon))),
            format!("--kokoro-length-scale={scale}"),
        ],
        Engine::Piper => vec![
            format!("--vits-model={}", p(dir.join(v.model))),
            format!("--vits-tokens={}", p(dir.join("tokens.txt"))),
            format!("--vits-lexicon={}", p(root.join(v.lexicon))),
            format!("--vits-length-scale={scale}"),
        ],
    };
    if let Some(s) = v.speaker {
        a.push(format!("--sid={s}"));
    }
    a.extend([format!("--num-threads={threads}"), "--tts-max-num-sentences=2".into(), format!("--output-filename={}", p(out.to_path_buf())), text.to_string()]);
    a
}

pub(crate) fn silence(rate: u32, ms: u32) -> usize {
    (rate as u64 * ms.min(MAX_PAUSE_MS) as u64 / 1000) as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::voices::VOICES;

    fn chunk(text: &str, pause: u32) -> Chunk {
        Chunk { text: text.into(), pause_after_ms: pause }
    }

    #[test]
    fn batches_honour_hard_pauses_and_size_limits() {
        let long = "x".repeat(1300);
        let b = plan_batches(&[chunk("Title", 1000), chunk("short.", 600), chunk(&long, 600), chunk("tail", 600)]);
        assert_eq!(b.iter().map(|b| b.pause_after_ms).collect::<Vec<_>>(), vec![1000, 600, 600]);
        assert_eq!(b[0].text, "Title");
        assert!(b[1].text.starts_with("short. xxx"));
        let many: Vec<Chunk> = (0..40).map(|_| chunk(&"y".repeat(200), 250)).collect();
        assert!(plan_batches(&many).iter().all(|b| b.text.len() <= MAX_BATCH_CHARS));
        assert_eq!(plan_batches(&[chunk("--flag looking", 600), chunk("  ", 600)])[0].text, "flag looking");
    }

    #[test]
    fn pauses_are_clamped() {
        assert_eq!(plan_batches(&[chunk("Title", u32::MAX)])[0].pause_after_ms, MAX_PAUSE_MS);
        assert_eq!(silence(24_000, u32::MAX), 240_000);
        assert_eq!(silence(24_000, 1000), 24_000);
    }

    #[test]
    fn engine_args_pass_speed_speaker_and_text_as_separate_arguments() {
        let v = VOICES.iter().find(|v| v.id == "kokoro-heart").unwrap();
        let a = engine_args(v, Path::new("/v"), 1.25, 3, Path::new("/o.wav"), "Hello; rm -rf /");
        assert!(a.contains(&"--kokoro-length-scale=0.8000".to_string()) && a.contains(&"--sid=3".to_string()));
        assert_eq!(a.last().unwrap(), "Hello; rm -rf /");
        let p = engine_args(VOICES.iter().find(|v| v.id == "piper-amy").unwrap(), Path::new("/v"), 1.0, 1, Path::new("/o.wav"), "x");
        assert!(p.iter().all(|s| !s.starts_with("--sid")) && p.contains(&"--vits-lexicon=/v/lexicon-en-us.txt".to_string()));
    }
}

//! Rendering one chapter or a sample: validation, synthesis, encoding and the atomic write under `exports/`.
use super::batch::Chunk;
use super::encode;
use super::engine::synthesize;
use super::error::{other, AudioError};
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
}

/// Formats this build can write. There is no MP3 on purpose (see docs/architecture.md, "Audio encoders").
const WRITABLE: &[&str] = &["wav", "flac", "opus"];

fn check_request(req: &ChapterRequest) -> Result<(), AudioError> {
    if req.chunks.iter().all(|c| c.text.trim().is_empty()) {
        return Err(other("there is nothing to read aloud in this chapter"));
    }
    if !(0.5..=2.0).contains(&req.speed) {
        return Err(other("speed must be between 0.5 and 2"));
    }
    if req.formats.is_empty() {
        return Err(other("choose at least one audio format"));
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
    Ok(write_wav(rate, &samples))
}

/// Renders one chapter. `progress` receives 0..1 after every batch. Everything is validated before the engine runs,
/// and nothing is written unless the whole chapter rendered.
pub fn render_chapter(req: &ChapterRequest, sherpa: &Path, voices: Option<&Path>, cancel: &AtomicBool, progress: &dyn Fn(f64)) -> Result<RenderedChapter, AudioError> {
    check_request(req)?;
    let root = project::require_project(&PathBuf::from(&req.root))?;
    for f in &req.formats {
        project::resolve(&root, &format!("{}.{f}", req.base))?;
    }
    let (samples, rate) = synthesize(&req.chunks, &req.voice, req.speed, sherpa, voices, cancel, progress)?;
    if cancel.load(Ordering::Relaxed) {
        return Err(AudioError::Cancelled);
    }
    let mut files = Vec::new();
    for f in &req.formats {
        if cancel.load(Ordering::Relaxed) {
            return Err(AudioError::Cancelled);
        }
        let encoded = match f.as_str() {
            "wav" => Ok(write_wav(rate, &samples)),
            "flac" => encode::encode_flac(rate, &samples),
            _ => encode::encode_opus(rate, &samples),
        };
        let bytes = encoded.map_err(|message| AudioError::Encode { format: f.clone(), message })?;
        let path = format!("{}.{f}", req.base);
        project::write_bytes(&root, &path, &bytes)?;
        files.push(RenderedFile { format: f.clone(), path });
    }
    Ok(RenderedChapter { files, duration_sec: samples.len() as f64 / rate as f64 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::engine::find_sherpa;
    use crate::audio::jobs::voices_root;
    use crate::audio::voices::{list_voices, VOICES};
    use crate::audio::wav::parse_wav;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    fn chunk(text: &str, pause: u32) -> Chunk {
        Chunk { text: text.into(), pause_after_ms: pause }
    }

    #[cfg(unix)]
    mod process {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        /// A stand-in engine: copies `fixture` to the `--output-filename=` argument, or runs `body`.
        fn script(dir: &Path, body: &str) -> PathBuf {
            let p = dir.join("fake-engine");
            fs::write(&p, format!("#!/bin/sh\nfor a in \"$@\"; do case \"$a\" in --output-filename=*) out=\"${{a#--output-filename=}}\";; esac; done\n{body}\n")).unwrap();
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
            p
        }

        struct Fixture {
            _dir: tempfile::TempDir,
            project: PathBuf,
            voices: PathBuf,
            engine: PathBuf,
        }

        fn fixture(body: impl Fn(&Path) -> String) -> Fixture {
            let dir = tempfile::tempdir().unwrap();
            let (project, voices) = (dir.path().join("book"), dir.path().join("voices"));
            fs::create_dir_all(&project).unwrap();
            fs::write(project.join("cadabra.json"), "{}").unwrap();
            let amy = VOICES.iter().find(|v| v.id == "piper-amy").unwrap();
            for f in amy.files(&voices) {
                fs::create_dir_all(f.parent().unwrap()).unwrap();
                fs::write(f, b"x").unwrap();
            }
            let wav = dir.path().join("fixture.wav");
            fs::write(&wav, write_wav(24000, &vec![1000i16; 2400])).unwrap(); // 0.1 s
            let engine = script(dir.path(), &body(&wav));
            Fixture { _dir: dir, project, voices, engine }
        }

        fn request(f: &Fixture, chunks: Vec<Chunk>) -> ChapterRequest {
            ChapterRequest { job_id: "j".into(), root: f.project.to_string_lossy().into_owned(), base: "exports/audio/01-one".into(), chunks, voice: "piper-amy".into(), speed: 1.0, formats: vec!["wav".into()] }
        }

        fn copy(wav: &Path) -> String {
            format!("cp '{}' \"$out\"", wav.display())
        }

        #[test]
        fn renders_batches_joins_them_with_pauses_and_writes_under_exports() {
            let f = fixture(copy);
            let seen = Mutex::new(Vec::new());
            let r = render_chapter(&request(&f, vec![chunk("Title", 1000), chunk("Body one.", 600), chunk("Body two.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &|p| seen.lock().unwrap().push(p)).unwrap();
            // two batches of 0.1 s plus a 1.0 s pause after the first and 0.6 s after the second
            assert!((r.duration_sec - 1.8).abs() < 0.001, "{}", r.duration_sec);
            assert_eq!(r.files, vec![RenderedFile { format: "wav".into(), path: "exports/audio/01-one.wav".into() }]);
            let pcm = parse_wav(&fs::read(f.project.join("exports/audio/01-one.wav")).unwrap()).unwrap();
            assert_eq!(pcm.samples.len(), (1.8 * 24000.0) as usize);
            let seen = seen.into_inner().unwrap();
            assert!(seen.windows(2).all(|w| w[0] <= w[1]) && (seen.last().unwrap() - 1.0).abs() < 1e-9);
        }

        #[test]
        fn a_sample_returns_wav_bytes_writes_nothing_and_cleans_up() {
            let f = fixture(copy);
            let req = SampleRequest { job_id: "s".into(), chunks: vec![chunk("Hello there.", 600)], voice: "piper-amy".into(), speed: 1.0 };
            let bytes = render_sample(&req, &f.engine, Some(&f.voices), &AtomicBool::new(false)).unwrap();
            assert_eq!(parse_wav(&bytes).unwrap().samples.len(), (0.7 * 24000.0) as usize);
            assert!(!f.project.join("exports").exists(), "a sample must not write into the project");
        }

        #[test]
        fn a_sample_refuses_long_text_bad_speed_and_a_missing_voice() {
            let f = fixture(copy);
            let mk = |text: String, speed: f64, voice: &str| SampleRequest { job_id: "s".into(), chunks: vec![chunk(&text, 0)], voice: voice.into(), speed };
            let off = AtomicBool::new(false);
            assert!(render_sample(&mk("a".repeat(SAMPLE_MAX_CHARS + 1), 1.0, "piper-amy"), &f.engine, Some(&f.voices), &off).is_err());
            assert!(render_sample(&mk("Hi.".into(), 3.0, "piper-amy"), &f.engine, Some(&f.voices), &off).is_err());
            assert!(matches!(render_sample(&mk("Hi.".into(), 1.0, "kokoro-heart"), &f.engine, Some(&f.voices), &off), Err(AudioError::VoiceMissing { .. })));
        }

        #[test]
        fn writes_every_requested_format_next_to_each_other() {
            let f = fixture(copy);
            let mut r = request(&f, vec![chunk("Hello there.", 600)]);
            r.formats = vec!["opus".into(), "flac".into(), "wav".into()];
            let done = render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {}).unwrap();
            assert_eq!(done.files.iter().map(|x| (x.format.as_str(), x.path.as_str())).collect::<Vec<_>>(), vec![("opus", "exports/audio/01-one.opus"), ("flac", "exports/audio/01-one.flac"), ("wav", "exports/audio/01-one.wav")]);
            let read = |n: &str| fs::read(f.project.join(format!("exports/audio/01-one.{n}"))).unwrap();
            assert_eq!(&read("opus")[..4], b"OggS");
            assert_eq!(&read("flac")[..4], b"fLaC");
            assert_eq!(&read("wav")[..4], b"RIFF");
        }

        #[test]
        fn cancel_kills_the_engine_promptly_and_writes_nothing() {
            let f = fixture(|_| "sleep 30".into());
            let cancel = Arc::new(AtomicBool::new(false));
            let c = cancel.clone();
            let t = std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                c.store(true, Ordering::Relaxed);
            });
            let started = Instant::now();
            let r = render_chapter(&request(&f, vec![chunk("Hello there.", 600)]), &f.engine, Some(&f.voices), &cancel, &|_| {});
            t.join().unwrap();
            assert_eq!(r, Err(AudioError::Cancelled));
            assert!(started.elapsed() < Duration::from_secs(5));
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_cancel_that_arrived_earlier_stops_before_the_engine_starts() {
            let f = fixture(copy);
            let r = render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(true), &|_| {});
            assert_eq!(r, Err(AudioError::Cancelled));
        }

        #[test]
        fn engine_failure_reports_its_message_and_writes_nothing() {
            let f = fixture(|_| "echo 'model file is corrupt' >&2; exit 3".into());
            let r = render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {});
            assert!(matches!(&r, Err(AudioError::Synth { message }) if message.contains("model file is corrupt")), "{r:?}");
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_missing_output_file_or_garbage_wav_is_a_synth_error() {
            let f = fixture(|_| "true".into());
            assert!(matches!(render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {}), Err(AudioError::Synth { .. })));
            let g = fixture(|_| "echo garbage > \"$out\"".into());
            assert!(matches!(render_chapter(&request(&g, vec![chunk("Hello.", 600)]), &g.engine, Some(&g.voices), &AtomicBool::new(false), &|_| {}), Err(AudioError::Synth { .. })));
        }

        #[test]
        fn bad_requests_are_refused_before_the_engine_runs() {
            let f = fixture(|_| "touch \"$(dirname \"$0\")/ran\"".into());
            let run = |mutate: &dyn Fn(&mut ChapterRequest)| {
                let mut r = request(&f, vec![chunk("Hello.", 600)]);
                mutate(&mut r);
                render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {})
            };
            assert!(matches!(run(&|r| r.voice = "kokoro-heart".into()), Err(AudioError::VoiceMissing { .. })));
            assert!(matches!(run(&|r| r.voice = "nope".into()), Err(AudioError::VoiceMissing { .. })));
            assert!(matches!(run(&|r| r.formats = vec!["mp3".into()]), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.formats = vec!["ogg".into()]), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.formats = vec![]), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.speed = 3.0), Err(AudioError::Other { .. })));
            assert!(matches!(run(&|r| r.chunks = vec![chunk("  ", 0)]), Err(AudioError::Other { .. })));
            for base in ["manifest", "exports/../cadabra", "/etc/x", "exports/"] {
                assert!(matches!(run(&|r| r.base = base.into()), Err(AudioError::Other { .. })), "{base}");
            }
            assert!(matches!(run(&|r| r.root = "relative/book".into()), Err(AudioError::Other { .. })));
            assert!(!f.engine.parent().unwrap().join("ran").exists());
            assert!(matches!(render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, None, &AtomicBool::new(false), &|_| {}), Err(AudioError::VoiceMissing { .. })));
        }
    }

    /// The real engine and voices, or None (test skipped) unless `REQUIRE_SHERPA=1`. Set `SHERPA_TTS_BIN` and
    /// `CADABRA_VOICES_DIR` (a folder holding the extracted sherpa model archives and `lexicon-en-us.txt`).
    fn real_engine() -> Option<(PathBuf, PathBuf)> {
        let found = find_sherpa().ok().zip(voices_root());
        if found.is_none() {
            assert!(std::env::var("REQUIRE_SHERPA").as_deref() != Ok("1"), "REQUIRE_SHERPA=1 but the engine or voices were not found");
            eprintln!("skipping: voice engine not installed");
        }
        found
    }

    #[test]
    fn real_engine_renders_a_short_chapter_with_a_piper_voice() {
        let Some((bin, voices)) = real_engine() else { return };
        if !list_voices(Some(&voices)).iter().any(|v| v.id == "piper-amy" && v.installed) {
            eprintln!("skipping: piper-amy is not installed");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
        let req = ChapterRequest { job_id: "real".into(), root: dir.path().to_string_lossy().into_owned(), base: "exports/audio/01-real".into(), chunks: vec![chunk("The quay was empty. A gull cried once.", 600)], voice: "piper-amy".into(), speed: 1.0, formats: vec!["wav".into()] };
        let r = render_chapter(&req, &bin, Some(&voices), &AtomicBool::new(false), &|_| {}).unwrap();
        assert!(r.duration_sec > 1.0 && r.duration_sec < 30.0, "{}", r.duration_sec);
        assert!(dir.path().join("exports/audio/01-real.wav").is_file());
    }
}

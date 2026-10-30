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
    /// Also keep a lossless FLAC of this chapter here (`.cadabra/audio/parts/<name>.flac`) for the M4B, which is built
    /// from the parts of all chapters. Not an export: it is never listed in `files`.
    #[serde(default)]
    pub part: Option<String>,
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
pub fn render_chapter(req: &ChapterRequest, sherpa: &Path, voices: Option<&Path>, cancel: &AtomicBool, progress: &dyn Fn(f64)) -> Result<RenderedChapter, AudioError> {
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
            _ => encode::encode_opus(rate, samples),
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
    Ok(RenderedChapter { files, duration_sec: samples.len() as f64 / rate as f64, part: req.part.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::engine::find_sherpa;
    use crate::audio::jobs::voices_root;
    use crate::audio::voices::list_voices;
    #[cfg(unix)]
    use crate::audio::voices::VOICES;
    #[cfg(unix)]
    use crate::audio::wav::parse_wav;
    use std::fs;
    #[cfg(unix)]
    use std::sync::{Arc, Mutex};
    #[cfg(unix)]
    use std::time::{Duration, Instant};

    fn ignore(_: f64) {}

    fn chunk(text: &str, pause: u32) -> Chunk {
        Chunk { text: text.into(), pause_after_ms: pause }
    }

    #[test]
    fn a_chapter_request_with_too_much_text_or_too_many_chunks_is_refused() {
        let req = |chunks: Vec<Chunk>| ChapterRequest { job_id: "j".into(), root: "/r".into(), base: "exports/a".into(), chunks, voice: "piper-amy".into(), speed: 1.0, formats: vec!["wav".into()], part: None };
        assert!(check_request(&req(vec![chunk("Hi.", 600)])).is_ok());
        let long = "x".repeat(CHAPTER_MAX_CHARS + 1);
        assert!(matches!(check_request(&req(vec![chunk(&long, 0)])), Err(AudioError::Other { message }) if message.contains("too long")));
        assert!(check_request(&req((0..=CHAPTER_MAX_CHUNKS).map(|_| chunk("a", 0)).collect())).is_err());
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
            fs::write(&wav, write_wav(24000, &vec![1000i16; 2400]).unwrap()).unwrap(); // 0.1 s
            let engine = script(dir.path(), &body(&wav));
            Fixture { _dir: dir, project, voices, engine }
        }

        fn request(f: &Fixture, chunks: Vec<Chunk>) -> ChapterRequest {
            ChapterRequest { job_id: "j".into(), root: f.project.to_string_lossy().into_owned(), base: "exports/audio/01-one".into(), chunks, voice: "piper-amy".into(), speed: 1.0, formats: vec!["wav".into()], part: None }
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
        fn an_edition_writes_under_its_language_folder_and_keeps_its_own_part() {
            let f = fixture(copy);
            let mut req = request(&f, vec![chunk("Bonjour.", 600)]);
            req.base = "exports/fr/audio/01-un".into();
            req.part = Some(".cadabra/audio/parts/fr_ch-1.flac".into());
            let r = render_chapter(&req, &f.engine, Some(&f.voices), &AtomicBool::new(false), &|_| {}).unwrap();
            assert_eq!(r.files, vec![RenderedFile { format: "wav".into(), path: "exports/fr/audio/01-un.wav".into() }]);
            assert!(f.project.join("exports/fr/audio/01-un.wav").is_file());
            assert!(!f.project.join("exports/audio").exists());
            assert!(f.project.join(".cadabra/audio/parts/fr_ch-1.flac").is_file());
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
        fn a_sample_with_nothing_to_read_is_refused() {
            let f = fixture(copy);
            let req = SampleRequest { job_id: "s".into(), chunks: vec![chunk("   ", 0)], voice: "piper-amy".into(), speed: 1.0 };
            assert!(matches!(render_sample(&req, &f.engine, Some(&f.voices), &AtomicBool::new(false)), Err(AudioError::Other { message }) if message.contains("nothing to read")));
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
        fn a_part_is_a_flac_under_the_parts_folder_and_not_an_export() {
            let f = fixture(copy);
            let mut r = request(&f, vec![chunk("Hello there.", 600)]);
            r.formats = vec![];
            r.part = Some(".cadabra/audio/parts/ch-1.flac".into());
            let done = render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore).unwrap();
            assert!(done.files.is_empty());
            assert_eq!(done.part.as_deref(), Some(".cadabra/audio/parts/ch-1.flac"));
            assert!(fs::read(f.project.join(".cadabra/audio/parts/ch-1.flac")).unwrap().starts_with(b"fLaC"));
            assert!(!f.project.join("exports").exists());
            for bad in ["exports/ch.flac", ".cadabra/audio/parts/x.wav", ".cadabra/audio/parts/../x.flac"] {
                r.part = Some(bad.into());
                assert!(render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore).is_err(), "{bad}");
            }
        }

        #[test]
        fn writes_every_requested_format_next_to_each_other() {
            let f = fixture(copy);
            let mut r = request(&f, vec![chunk("Hello there.", 600)]);
            r.formats = vec!["opus".into(), "flac".into(), "wav".into()];
            let done = render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore).unwrap();
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
            let r = render_chapter(&request(&f, vec![chunk("Hello there.", 600)]), &f.engine, Some(&f.voices), &cancel, &ignore);
            t.join().unwrap();
            assert_eq!(r, Err(AudioError::Cancelled));
            assert!(started.elapsed() < Duration::from_secs(5));
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_cancel_that_arrived_earlier_stops_before_the_engine_starts() {
            let f = fixture(copy);
            let r = render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(true), &ignore);
            assert_eq!(r, Err(AudioError::Cancelled));
        }

        #[test]
        fn an_engine_that_changes_its_sample_rate_part_way_is_a_synth_error() {
            let f = fixture(|wav| {
                let other = wav.with_file_name("fixture16k.wav");
                fs::write(&other, write_wav(16000, &vec![1000i16; 1600]).unwrap()).unwrap();
                let seen = wav.with_file_name("seen");
                format!("if [ -f '{seen}' ]; then cp '{other}' \"$out\"; else touch '{seen}'; cp '{wav}' \"$out\"; fi", seen = seen.display(), other = other.display(), wav = wav.display())
            });
            let r = render_chapter(&request(&f, vec![chunk("Title", 1000), chunk("Body.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore);
            assert!(matches!(&r, Err(AudioError::Synth { message }) if message.contains("sample rate")), "{r:?}");
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_cancel_that_arrives_after_the_last_batch_still_cancels_and_writes_nothing() {
            let f = fixture(copy);
            let cancel = AtomicBool::new(false);
            let r = render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &cancel, &|_| cancel.store(true, Ordering::Relaxed));
            assert_eq!(r, Err(AudioError::Cancelled));
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn the_short_chapter_check_runs_against_a_stand_in_engine() {
            let f = fixture(copy);
            render_short_chapter(Some((f.engine.clone(), f.voices.clone())), 0.5);
            // A voices folder without piper-amy skips the render; no engine at all skips it too.
            render_short_chapter(Some((f.engine.clone(), f.voices.join("none"))), 0.5);
            render_short_chapter(None, 0.5);
        }

        #[test]
        fn engine_failure_reports_its_message_and_writes_nothing() {
            let f = fixture(|_| "echo 'model file is corrupt' >&2; exit 3".into());
            let r = render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore);
            assert!(matches!(&r, Err(AudioError::Synth { message }) if message.contains("model file is corrupt")), "{r:?}");
            assert!(!f.project.join("exports").exists());
        }

        #[test]
        fn a_missing_output_file_or_garbage_wav_is_a_synth_error() {
            let f = fixture(|_| "true".into());
            assert!(matches!(render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore), Err(AudioError::Synth { .. })));
            let g = fixture(|_| "echo garbage > \"$out\"".into());
            assert!(matches!(render_chapter(&request(&g, vec![chunk("Hello.", 600)]), &g.engine, Some(&g.voices), &AtomicBool::new(false), &ignore), Err(AudioError::Synth { .. })));
        }

        #[test]
        fn bad_requests_are_refused_before_the_engine_runs() {
            let f = fixture(|_| "touch \"$(dirname \"$0\")/ran\"".into());
            let run = |mutate: &dyn Fn(&mut ChapterRequest)| {
                let mut r = request(&f, vec![chunk("Hello.", 600)]);
                mutate(&mut r);
                render_chapter(&r, &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore)
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
            assert!(matches!(render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, None, &AtomicBool::new(false), &ignore), Err(AudioError::VoiceMissing { .. })));
        }
    }

    /// The real engine and voices, or None (test skipped) unless `REQUIRE_SHERPA=1`. Set `SHERPA_TTS_BIN` and
    /// `CADABRA_VOICES_DIR` (a folder holding the extracted sherpa model archives and `lexicon-en-us.txt`).
    fn real_engine() -> Option<(PathBuf, PathBuf)> {
        real_engine_from(find_sherpa().ok().zip(voices_root()), std::env::var("REQUIRE_SHERPA").as_deref() == Ok("1"))
    }

    fn real_engine_from(found: Option<(PathBuf, PathBuf)>, required: bool) -> Option<(PathBuf, PathBuf)> {
        if found.is_none() {
            assert!(!required, "REQUIRE_SHERPA=1 but the engine or voices were not found");
            eprintln!("skipping: voice engine not installed");
        }
        found
    }

    #[test]
    fn a_missing_engine_skips_the_real_tests_unless_it_is_required() {
        assert_eq!(real_engine_from(None, false), None);
        let here = Some((PathBuf::from("/e"), PathBuf::from("/v")));
        assert_eq!(real_engine_from(here.clone(), true), here);
        assert!(std::panic::catch_unwind(|| real_engine_from(None, true)).is_err());
    }

    #[test]
    fn real_engine_renders_a_short_chapter_with_a_piper_voice() {
        render_short_chapter(real_engine(), 1.0);
    }

    /// Renders a sentence with piper-amy through `found` (engine, voices folder) and checks the length (at least
    /// `min_secs`). Does nothing when there is no engine or the voice is not installed.
    fn render_short_chapter(found: Option<(PathBuf, PathBuf)>, min_secs: f64) {
        let Some((bin, voices)) = found else { return };
        if !list_voices(Some(&voices)).iter().any(|v| v.id == "piper-amy" && v.installed) {
            eprintln!("skipping: piper-amy is not installed");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
        let req = ChapterRequest { job_id: "real".into(), root: dir.path().to_string_lossy().into_owned(), base: "exports/audio/01-real".into(), chunks: vec![chunk("The quay was empty. A gull cried once.", 600)], voice: "piper-amy".into(), speed: 1.0, formats: vec!["wav".into()], part: None };
        let r = render_chapter(&req, &bin, Some(&voices), &AtomicBool::new(false), &ignore).unwrap();
        assert!(r.duration_sec > min_secs && r.duration_sec < 30.0, "{}", r.duration_sec);
        assert!(dir.path().join("exports/audio/01-real.wav").is_file());
    }

    fn outputs(formats: &[&str], part: Option<&str>) -> (tempfile::TempDir, ChapterRequest) {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
        let req = ChapterRequest { job_id: "j".into(), root: dir.path().to_string_lossy().into_owned(), base: "exports/audio/01-one".into(), chunks: vec![], voice: "piper-amy".into(), speed: 1.0, formats: formats.iter().map(|f| f.to_string()).collect(), part: part.map(str::to_string) };
        (dir, req)
    }

    #[test]
    fn a_cancel_between_files_stops_the_remaining_outputs() {
        let samples = vec![500i16; 2400];
        let (dir, req) = outputs(&["wav"], None);
        let r = write_outputs(&req, dir.path(), 24000, &samples, &AtomicBool::new(true));
        assert_eq!(r, Err(AudioError::Cancelled));
        assert!(!dir.path().join("exports").exists());
        let (dir, req) = outputs(&[], Some(".cadabra/audio/parts/ch-1.flac"));
        assert_eq!(write_outputs(&req, dir.path(), 24000, &samples, &AtomicBool::new(true)), Err(AudioError::Cancelled));
        assert!(!dir.path().join(".cadabra").exists());
    }

    #[test]
    fn an_encoder_failure_names_the_format() {
        let (dir, req) = outputs(&["flac"], None);
        assert!(matches!(write_outputs(&req, dir.path(), 24000, &[], &AtomicBool::new(false)), Err(AudioError::Encode { format, .. }) if format == "flac"));
        let (dir, req) = outputs(&["opus"], None);
        assert!(matches!(write_outputs(&req, dir.path(), 24000, &[], &AtomicBool::new(false)), Err(AudioError::Encode { format, .. }) if format == "opus"));
        let (dir, req) = outputs(&[], Some(".cadabra/audio/parts/ch-1.flac"));
        assert!(matches!(write_outputs(&req, dir.path(), 24000, &[], &AtomicBool::new(false)), Err(AudioError::Encode { format, .. }) if format == "flac"));
    }
}

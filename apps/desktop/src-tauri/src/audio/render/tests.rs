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
    let req = |chunks: Vec<Chunk>| ChapterRequest {
        job_id: "j".into(),
        root: "/r".into(),
        base: "exports/a".into(),
        chunks,
        voice: "piper-amy".into(),
        speed: 1.0,
        formats: vec!["wav".into()],
        part: None,
        language: None,
    };
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
        fs::write(&p, format!("#!/bin/sh\nfor a in \"$@\"; do case \"$a\" in --output-filename=*) out=\"${{a#--output-filename=}}\";; esac; done\n{body}\n"))
            .unwrap();
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
        ChapterRequest {
            job_id: "j".into(),
            root: f.project.to_string_lossy().into_owned(),
            base: "exports/audio/01-one".into(),
            chunks,
            voice: "piper-amy".into(),
            speed: 1.0,
            formats: vec!["wav".into()],
            part: None,
            language: None,
        }
    }

    fn copy(wav: &Path) -> String {
        format!("cp '{}' \"$out\"", wav.display())
    }

    #[test]
    fn renders_batches_joins_them_with_pauses_and_writes_under_exports() {
        let f = fixture(copy);
        let seen = Mutex::new(Vec::new());
        let r = render_chapter(
            &request(&f, vec![chunk("Title", 1000), chunk("Body one.", 600), chunk("Body two.", 600)]),
            &f.engine,
            Some(&f.voices),
            &AtomicBool::new(false),
            &|p| seen.lock().unwrap().push(p),
        )
        .unwrap();
        // two batches of 0.1 s plus a 1.0 s pause after the first and 0.6 s after the second
        assert!((r.duration_sec - 1.8).abs() < 0.001, "{}", r.duration_sec);
        assert_eq!(r.loudness.target_lufs, -19.0);
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
        assert!(
            matches!(render_sample(&req, &f.engine, Some(&f.voices), &AtomicBool::new(false)), Err(AudioError::Other { message }) if message.contains("nothing to read"))
        );
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
        assert_eq!(
            done.files.iter().map(|x| (x.format.as_str(), x.path.as_str())).collect::<Vec<_>>(),
            vec![("opus", "exports/audio/01-one.opus"), ("flac", "exports/audio/01-one.flac"), ("wav", "exports/audio/01-one.wav")]
        );
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
            format!(
                "if [ -f '{seen}' ]; then cp '{other}' \"$out\"; else touch '{seen}'; cp '{wav}' \"$out\"; fi",
                seen = seen.display(),
                other = other.display(),
                wav = wav.display()
            )
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
        assert!(matches!(
            render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, Some(&f.voices), &AtomicBool::new(false), &ignore),
            Err(AudioError::Synth { .. })
        ));
        let g = fixture(|_| "echo garbage > \"$out\"".into());
        assert!(matches!(
            render_chapter(&request(&g, vec![chunk("Hello.", 600)]), &g.engine, Some(&g.voices), &AtomicBool::new(false), &ignore),
            Err(AudioError::Synth { .. })
        ));
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
        assert!(matches!(
            render_chapter(&request(&f, vec![chunk("Hello.", 600)]), &f.engine, None, &AtomicBool::new(false), &ignore),
            Err(AudioError::VoiceMissing { .. })
        ));
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
    let req = ChapterRequest {
        job_id: "real".into(),
        root: dir.path().to_string_lossy().into_owned(),
        base: "exports/audio/01-real".into(),
        chunks: vec![chunk("The quay was empty. A gull cried once.", 600)],
        voice: "piper-amy".into(),
        speed: 1.0,
        formats: vec!["wav".into()],
        part: None,
        language: None,
    };
    let r = render_chapter(&req, &bin, Some(&voices), &AtomicBool::new(false), &ignore).unwrap();
    assert!(r.duration_sec > min_secs && r.duration_sec < 30.0, "{}", r.duration_sec);
    assert!(dir.path().join("exports/audio/01-real.wav").is_file());
}

fn outputs(formats: &[&str], part: Option<&str>) -> (tempfile::TempDir, ChapterRequest) {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
    let req = ChapterRequest {
        job_id: "j".into(),
        root: dir.path().to_string_lossy().into_owned(),
        base: "exports/audio/01-one".into(),
        chunks: vec![],
        voice: "piper-amy".into(),
        speed: 1.0,
        formats: formats.iter().map(|f| f.to_string()).collect(),
        part: part.map(str::to_string),
        language: None,
    };
    (dir, req)
}

#[test]
fn transcripts_are_text_files_in_an_audio_folder_under_exports() {
    for ok in ["exports/audio/book-transcript.txt", "exports/fr/audio/01-un.vtt", "exports/pt-BR/audio/a_b.1.txt"] {
        assert!(is_transcript_path(ok), "{ok}");
    }
    for bad in [
        "exports/audio/a.json",
        "exports/audio/a",
        "exports/fr/a.txt",
        "audio/a.txt",
        "exports/audio/.txt",
        "exports/audio/.hid.txt",
        "exports/audio/a b.txt",
        "exports/audio/../a.txt",
        "exports/audio/",
        "exports/audio/x/y.txt",
        "cadabra.json",
    ] {
        assert!(!is_transcript_path(bad), "{bad}");
    }
}

#[test]
fn a_transcript_is_written_atomically_and_replaces_the_earlier_one() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
    write_transcript(dir.path(), "exports/fr/audio/t.txt", "un\n").unwrap();
    write_transcript(dir.path(), "exports/fr/audio/t.txt", "deux\n").unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("exports/fr/audio/t.txt")).unwrap(), "deux\n");
    let names: Vec<_> = fs::read_dir(dir.path().join("exports/fr/audio")).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 1, "no temp file is left behind: {names:?}");
    assert!(write_transcript(dir.path(), "cadabra.json", "x").is_err());
    assert!(write_transcript(dir.path(), "exports/audio/../../x.txt", "x").is_err());
    assert!(write_transcript(dir.path(), "exports/audio/big.txt", &"a".repeat(TRANSCRIPT_MAX_BYTES + 1)).is_err());
    assert_eq!(fs::read_to_string(dir.path().join("cadabra.json")).unwrap(), "{}");
}

#[test]
fn the_edition_language_is_written_into_the_opus_chapter_file() {
    let samples = vec![500i16; 4800];
    let (dir, mut req) = outputs(&["opus"], None);
    req.language = Some("de".into());
    write_outputs(&req, dir.path(), 24000, &samples, &AtomicBool::new(false)).unwrap();
    let bytes = fs::read(dir.path().join("exports/audio/01-one.opus")).unwrap();
    assert!(bytes.windows(11).any(|w| w == b"LANGUAGE=de"));
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

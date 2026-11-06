use super::*;

fn chapter(title: &str, part: &str, secs: f64) -> M4bChapter {
    M4bChapter { title: title.into(), part: format!(".cadabra/audio/parts/{part}"), duration_sec: secs }
}

#[test]
fn metadata_lists_chapters_back_to_back_in_milliseconds_and_escapes_values() {
    let m = ffmetadata("A=B; #1", "Ann\\Lee", &[chapter("One", "a.flac", 1.5), chapter("Two\nlines", "b.flac", 0.0004), chapter("Three", "c.flac", 2.0)]);
    assert!(m.starts_with(";FFMETADATA1\ntitle=A\\=B\\; \\#1\nartist=Ann\\\\Lee\n"), "{m}");
    assert!(m.contains("[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=One\n"));
    assert!(m.contains("START=1500\nEND=1500\ntitle=Two\\\nlines\n"));
    assert!(m.contains("START=1500\nEND=3500\ntitle=Three\n"));
}

#[test]
fn part_names_must_be_plain_files_in_the_parts_folder() {
    assert_eq!(part_name(".cadabra/audio/parts/ch-1_a.flac").unwrap(), "ch-1_a.flac");
    for bad in [".cadabra/audio/parts/a'b.flac", ".cadabra/audio/parts/a b.flac", "exports/a.flac", ".cadabra/audio/parts/../a.flac", ".cadabra/audio/parts/a.wav", ".cadabra/audio/parts/é.flac"] {
        assert!(part_name(bad).is_err(), "{bad}");
    }
    let list = concat_list(&[PathBuf::from("/p/it's/a.flac"), PathBuf::from("/p/b.flac")]);
    assert_eq!(list, "file '/p/it'\\''s/a.flac'\nfile '/p/b.flac'\n");
}

#[test]
fn huge_durations_saturate_instead_of_overflowing() {
    let m = ffmetadata("T", "A", &[chapter("One", "a.flac", f64::MAX), chapter("Two", "b.flac", f64::MAX)]);
    assert!(m.contains(&format!("START=0\nEND={}\n", u64::MAX)), "{m}");
    assert!(m.contains(&format!("START={}\nEND={}\n", u64::MAX, u64::MAX)), "{m}");
}

#[test]
fn windows_paths_use_forward_slashes_in_the_list() {
    assert_eq!(forward_slashes("C:\\Books\\a.flac", true), "C:/Books/a.flac");
    assert_eq!(forward_slashes("/p/a\\b.flac", false), "/p/a\\b.flac");
}

#[test]
fn arguments_map_the_audio_chapters_and_the_cover_as_an_attached_picture() {
    let (l, m, o, c) = (Path::new("/t/l"), Path::new("/t/m"), Path::new("/t/o"), Path::new("/p/assets/c.png"));
    let with = ffmpeg_args(l, m, Some(c), Some("fr-CA"), o).join(" ");
    assert!(with.contains("-f concat -safe 0 -protocol_whitelist file,pipe -i /t/l -protocol_whitelist file,pipe -i /t/m -protocol_whitelist file,pipe -i /p/assets/c.png -map 0:a -map 2:v -map_metadata 1 -map_chapters 1 -c:a aac -b:a 64k -metadata:s:a:0 language=fra -c:v copy -disposition:v:0 attached_pic -f ipod /t/o"), "{with}");
    let without = ffmpeg_args(l, m, None, None, o).join(" ");
    assert!(!without.contains("2:v") && !without.contains("attached_pic") && without.ends_with("-f ipod /t/o"), "{without}");
    assert!(without.contains("-metadata:s:a:0 language=und"), "{without}");
}

#[test]
fn the_track_language_is_a_three_letter_code_and_odd_tags_are_undetermined() {
    for (tag, code) in [("en", "eng"), ("fr-CA", "fra"), ("PT-br", "por"), ("zh-Hant", "zho"), ("tlh", "tlh"), ("", "und"), ("x", "und"), ("fr FR", "und"), ("fr--CA", "und"), ("fr\nCA", "und")] {
        assert_eq!(iso639_2(Some(tag)), code, "{tag:?}");
    }
    assert_eq!(iso639_2(None), "und");
    assert_eq!(clean_language(Some(" fr-CA ")), Some("fr-CA".into()));
    assert_eq!(clean_language(Some(&"a".repeat(36))), None);
    assert_eq!(clean_language(Some("fr=CA")), None);
}

#[test]
fn the_encoder_output_is_read_up_to_the_cap_and_no_further() {
    let d = tempfile::tempdir().unwrap();
    let out = d.path().join("book.m4b");
    fs::write(&out, [7u8; 4]).unwrap();
    assert_eq!(read_encoded(&out, 4).unwrap(), vec![7u8; 4]);
    assert_eq!(read_encoded(&out, 3), Err(AudioError::from(ProjectError::TooLarge { path: "book.m4b".into(), max_mb: 0 })));
    fs::write(&out, []).unwrap();
    assert_eq!(read_encoded(&out, 4).unwrap(), Vec::<u8>::new(), "zero bytes are read as an empty file");
    assert!(read_encoded(d.path(), 4).is_err(), "a folder is not output");
}

#[cfg(unix)]
mod process {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    struct Fixture {
        _dir: tempfile::TempDir,
        project: PathBuf,
        ffmpeg: PathBuf,
    }

    /// A project with two parts, a cover and a stand-in ffmpeg that runs `body` (the output path is `$OUT`).
    fn fixture(body: &str) -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("book");
        fs::create_dir_all(project.join(".cadabra/audio/parts")).unwrap();
        fs::create_dir_all(project.join("assets")).unwrap();
        fs::write(project.join("cadabra.json"), "{}").unwrap();
        fs::write(project.join(".cadabra/audio/parts/a.flac"), b"fLaC-a").unwrap();
        fs::write(project.join(".cadabra/audio/parts/b.flac"), b"fLaC-b").unwrap();
        fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/assets/pixel.png"), project.join("assets/cover.png")).unwrap();
        let ffmpeg = dir.path().join("fake-ffmpeg");
        fs::write(&ffmpeg, format!("#!/bin/sh\nfor a in \"$@\"; do OUT=\"$a\"; done\n{body}\n")).unwrap();
        fs::set_permissions(&ffmpeg, fs::Permissions::from_mode(0o755)).unwrap();
        Fixture { _dir: dir, project, ffmpeg }
    }

    fn request(f: &Fixture) -> M4bRequest {
        M4bRequest {
            job_id: "j".into(),
            root: f.project.to_string_lossy().into_owned(),
            base: "exports/audio/book".into(),
            title: "Book".into(),
            author: "Me".into(),
            cover: Some("assets/cover.png".into()),
            chapters: vec![chapter("One", "a.flac", 1.0), chapter("Two", "b.flac", 2.0)],
            language: Some("fr-CA".into()),
        }
    }

    #[test]
    fn writes_the_m4b_under_exports_from_the_tools_output_and_cleans_up() {
        // The stand-in notes where its output goes (inside the temp dir), so the test can check that folder is gone.
        let f = fixture("echo m4b-bytes > \"$OUT\"; dirname \"$OUT\" > \"$NOTE\"");
        let note = f.project.join("note.txt");
        fs::write(&f.ffmpeg, fs::read_to_string(&f.ffmpeg).unwrap().replace("$NOTE", &note.to_string_lossy())).unwrap();
        let built = build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap();
        assert_eq!(built, BuiltM4b { path: "exports/audio/book.m4b".into(), duration_sec: 3.0 });
        assert_eq!(fs::read(f.project.join("exports/audio/book.m4b")).unwrap(), b"m4b-bytes\n");
        let scratch = fs::read_to_string(&note).unwrap();
        assert!(!Path::new(scratch.trim()).exists(), "the temp dir must be removed");
    }

    #[test]
    fn the_tool_is_told_the_track_language() {
        let f = fixture("for a in \"$@\"; do echo \"$a\"; done > \"$OUT\"");
        build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap();
        let args = fs::read_to_string(f.project.join("exports/audio/book.m4b")).unwrap();
        let lines: Vec<&str> = args.lines().collect();
        let at = lines.iter().position(|l| *l == "-metadata:s:a:0").expect("the stream language option");
        assert_eq!(lines[at + 1], "language=fra");
    }

    #[test]
    fn the_tool_gets_the_parts_in_order_as_absolute_paths() {
        let f = fixture("for a in \"$@\"; do case \"$a\" in *parts.txt) cat \"$a\" > \"$OUT\";; esac; done");
        build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap();
        let list = fs::read_to_string(f.project.join("exports/audio/book.m4b")).unwrap();
        let lines: Vec<&str> = list.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("file '/") && lines[0].ends_with("/.cadabra/audio/parts/a.flac'"), "{list}");
        assert!(lines[1].ends_with("/.cadabra/audio/parts/b.flac'"), "{list}");
    }

    #[test]
    fn a_failing_tool_is_an_encode_error_with_its_message_and_writes_nothing() {
        let f = fixture("echo 'bad input' >&2; exit 1");
        let e = build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap_err();
        assert_eq!(e, AudioError::Encode { format: "m4b".into(), message: "bad input".into() });
        assert!(!f.project.join("exports").exists());
    }

    #[test]
    fn a_tool_that_fails_silently_still_gets_a_message() {
        let f = fixture("exit 1");
        let e = build_m4b(&request(&f), &f.ffmpeg, &AtomicBool::new(false)).unwrap_err();
        assert!(matches!(e, AudioError::Encode { format, message } if format == "m4b" && message.contains("no message")));
    }

    #[test]
    fn cancel_kills_the_tool_promptly_and_leaves_nothing() {
        let f = fixture("sleep 30");
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        });
        let started = std::time::Instant::now();
        assert_eq!(build_m4b(&request(&f), &f.ffmpeg, &cancel).unwrap_err(), AudioError::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(!f.project.join("exports").exists());
    }

    #[test]
    fn bad_requests_are_refused_before_the_tool_runs() {
        let f = fixture("echo ran > \"$OUT\"");
        let off = AtomicBool::new(false);
        let mut r = request(&f);
        r.base = "elsewhere/book".into();
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
        let mut r = request(&f);
        r.chapters[0].part = "exports/a.flac".into();
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
        let mut r = request(&f);
        r.cover = Some("manuscript/c.png".into());
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
        let mut r = request(&f);
        r.cover = Some("assets/missing.png".into());
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
        let mut r = request(&f);
        r.chapters[1].part = ".cadabra/audio/parts/gone.flac".into();
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
        let mut r = request(&f);
        r.chapters.clear();
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_err());
        let mut r = request(&f);
        r.chapters = (0..=MAX_CHAPTERS).map(|_| chapter("x", "a.flac", 1.0)).collect();
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_err(), "too many chapters");
        let mut r = request(&f);
        r.cover = None;
        assert!(build_m4b(&r, &f.ffmpeg, &off).is_ok(), "no cover is allowed");
    }

    #[test]
    fn a_cover_that_is_not_an_image_is_refused_before_the_tool_runs() {
        let f = fixture("echo ran > \"$OUT\"");
        fs::write(f.project.join("assets/fake.png"), b"concat:http://example.com/x").unwrap();
        let mut r = request(&f);
        r.cover = Some("assets/fake.png".into());
        assert!(matches!(build_m4b(&r, &f.ffmpeg, &AtomicBool::new(false)), Err(AudioError::Other { .. })));
        assert!(!f.project.join("exports").exists());
    }

    #[test]
    fn a_missing_tool_is_not_found() {
        let f = fixture("true");
        let e = build_m4b(&request(&f), Path::new("/nope/ffmpeg"), &AtomicBool::new(false)).unwrap_err();
        assert!(matches!(e, AudioError::NotFound { .. }), "{e:?}");
    }
}

/// A real ffmpeg (`FFMPEG_BIN`, the bundled sidecar or PATH); `REQUIRE_FFMPEG=1` turns a missing one into a failure.
fn real_ffmpeg() -> Option<PathBuf> {
    let found = super::super::engine::find_ffmpeg().ok();
    assert!(found.is_some() || std::env::var_os("REQUIRE_FFMPEG").is_none(), "REQUIRE_FFMPEG is set but ffmpeg was not found");
    found
}

/// What `ffmpeg -i <file>` prints about the file (it exits with an error for lack of an output, which is fine).
fn describe(ffmpeg: &Path, file: &Path) -> String {
    let out = std::process::Command::new(ffmpeg).args(["-hide_banner", "-i"]).arg(file).output().unwrap();
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn real_ffmpeg_builds_an_aac_m4b_with_chapters_and_a_cover() {
    let Some(ffmpeg) = real_ffmpeg() else { return };
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("book");
    fs::create_dir_all(project.join(".cadabra/audio/parts")).unwrap();
    fs::create_dir_all(project.join("assets")).unwrap();
    fs::write(project.join("cadabra.json"), "{}").unwrap();
    let tone = |hz: f64, secs: f64| -> Vec<i16> { (0..(24000.0 * secs) as usize).map(|i| ((i as f64 * hz * std::f64::consts::TAU / 24000.0).sin() * 8000.0) as i16).collect() };
    for (name, hz, secs) in [("one", 300.0, 2.0), ("two", 500.0, 1.0)] {
        fs::write(project.join(format!(".cadabra/audio/parts/{name}.flac")), super::super::encode::encode_flac(24000, &tone(hz, secs)).unwrap()).unwrap();
    }
    fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/assets/pixel.png"), project.join("assets/cover.png")).unwrap();
    let req = M4bRequest {
        job_id: "r".into(),
        root: project.to_string_lossy().into_owned(),
        base: "exports/audio/book".into(),
        title: "Real Book".into(),
        author: "Me".into(),
        cover: Some("assets/cover.png".into()),
        chapters: vec![chapter("Chapter One", "one.flac", 2.0), chapter("Chapter Two", "two.flac", 1.0)],
        language: Some("fr".into()),
    };
    let built = build_m4b(&req, &ffmpeg, &AtomicBool::new(false)).unwrap();
    let out = project.join(&built.path);
    let info = describe(&ffmpeg, &out);
    assert!(info.contains("Audio: aac"), "{info}");
    assert!(info.contains("(fra): Audio"), "the track language is written:\n{info}");
    assert!(info.contains("(attached pic)"), "{info}");
    assert!(info.contains("Chapter #0:0: start 0.000000, end 2.000000") && info.contains("Chapter #0:1: start 2.000000, end 3.000000"), "{info}");
    for title in ["Chapter One", "Chapter Two", "Real Book"] {
        assert!(info.contains(&format!(": {title}")), "{title} is missing:\n{info}");
    }
    assert!(info.contains("Duration: 00:00:03."), "{info}");
}

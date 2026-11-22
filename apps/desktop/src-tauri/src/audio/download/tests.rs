use super::stub::*;
use super::*;
use crate::audio::packs::{RemoteFile, PACKS};
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};

fn noop(_: u64) {}

fn ignore_progress(_: DownloadProgress) {}

fn run(url: &str, data: &[u8], sha256: &str, dest: &Path, cancel: &AtomicBool) -> (Result<(), AudioError>, Vec<u64>) {
    let client = client(false).unwrap();
    let mut seen = Vec::new();
    let r = tauri::async_runtime::block_on(download_file(&client, url, data.len() as u64, sha256, dest, cancel, &mut |n| seen.push(n)));
    (r, seen)
}

#[test]
fn downloads_verifies_and_renames_without_leaving_a_part_file() {
    let data = body(300_000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("sub/file.bin");
    let (r, seen) = run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    assert_eq!(fs::read(&dest).unwrap(), data);
    assert!(!part_path(&dest).exists());
    assert!(seen.windows(2).all(|w| w[0] <= w[1]) && *seen.last().unwrap() == data.len() as u64);
}

#[test]
fn resumes_a_part_file_with_a_range_request() {
    let data = body(300_000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    fs::write(part_path(&dest), &data[..120_000]).unwrap();
    let (r, seen) = run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    assert_eq!(fs::read(&dest).unwrap(), data);
    assert_eq!(s.requests.lock().unwrap().as_slice(), &[Some("bytes=120000-".to_string())]);
    assert_eq!(seen[0], 120_000);
}

#[test]
fn starts_over_when_the_server_ignores_range() {
    let data = body(200_000);
    let s = serve(data.clone(), Mode::IgnoreRange);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    fs::write(part_path(&dest), &data[..50_000]).unwrap();
    let (r, _) = run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    assert_eq!(fs::read(&dest).unwrap(), data);
}

#[test]
fn a_wrong_hash_deletes_the_file_and_reports_which() {
    let data = body(100_000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    let (r, _) = run(&s.url, &data, &"0".repeat(64), &dest, &AtomicBool::new(false));
    assert_eq!(r, Err(AudioError::Checksum { file: "file.bin".into() }));
    assert!(!dest.exists() && !part_path(&dest).exists());
}

#[test]
fn cancel_stops_mid_download_and_keeps_the_part_file_for_a_resume() {
    let data = body(400_000);
    let s = serve(data.clone(), Mode::Slow);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    let cancel = Arc::new(AtomicBool::new(false));
    let c = cancel.clone();
    let t = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        c.store(true, Ordering::Relaxed);
    });
    let started = Instant::now();
    let (r, _) = run(&s.url, &data, &sha(&data), &dest, &cancel);
    t.join().unwrap();
    assert_eq!(r, Err(AudioError::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(!dest.exists());
    let kept = fs::metadata(part_path(&dest)).unwrap().len();
    assert!(kept > 0 && kept < data.len() as u64);
    // and the next attempt finishes it from there
    let fast = serve(data.clone(), Mode::Normal);
    let (r, _) = run(&fast.url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    assert_eq!(fs::read(&dest).unwrap(), data);
    assert_eq!(fast.requests.lock().unwrap()[0], Some(format!("bytes={kept}-")));
}

#[test]
fn server_errors_and_early_endings_are_download_errors_that_keep_what_was_fetched() {
    let data = body(100_000);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    let (r, _) = run(&serve(data.clone(), Mode::Status(404)).url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert!(matches!(&r, Err(AudioError::Download { message }) if message.contains("404")), "{r:?}");
    let (r, _) = run(&serve(data.clone(), Mode::Truncate).url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert!(matches!(r, Err(AudioError::Download { .. })), "{r:?}");
    assert!(!dest.exists());
    assert!(fs::metadata(part_path(&dest)).map_or(true, |m| m.len() < data.len() as u64));
}

#[test]
fn a_wrong_length_or_an_oversized_part_is_refused() {
    let data = body(1000);
    let dir = tempfile::tempdir().unwrap();
    let s = serve(data.clone(), Mode::Normal);
    let dest = dir.path().join("a.bin");
    let client = client(false).unwrap();
    let r = tauri::async_runtime::block_on(download_file(&client, &s.url, 999, &sha(&data), &dest, &AtomicBool::new(false), &mut noop));
    assert!(matches!(r, Err(AudioError::Download { .. })));
    let big = dir.path().join("b.bin");
    fs::write(part_path(&big), vec![1u8; 5000]).unwrap();
    let (r, _) = run(&s.url, &data, &sha(&data), &big, &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    assert_eq!(fs::read(&big).unwrap(), data);
}

#[test]
fn an_installed_file_is_not_fetched_again() {
    let data = body(5000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    fs::write(&dest, &data).unwrap();
    let (r, seen) = run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert_eq!((r, seen), (Ok(()), vec![5000]));
    assert!(s.requests.lock().unwrap().is_empty());
}

#[test]
fn an_installed_file_of_the_right_size_but_the_wrong_content_is_replaced() {
    let data = body(5000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    fs::write(&dest, vec![0u8; 5000]).unwrap(); // same size, not the pinned bytes
    let (r, _) = run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    assert_eq!(fs::read(&dest).unwrap(), data);
    assert_eq!(s.requests.lock().unwrap().len(), 1, "it was fetched again");
}

#[test]
fn a_file_of_a_different_size_and_a_zero_byte_file_are_downloaded() {
    let data = body(3000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    for (name, len) in [("short.bin", 2999), ("empty.bin", 0), ("long.bin", 3001)] {
        let dest = dir.path().join(name);
        fs::write(&dest, vec![1u8; len]).unwrap();
        assert_eq!(run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(false)).0, Ok(()), "{name}");
        assert_eq!(fs::read(&dest).unwrap(), data, "{name}");
    }
}

#[test]
fn a_download_past_its_deadline_stops_and_keeps_the_part_file() {
    let data = body(400_000);
    let s = serve(data.clone(), Mode::Slow);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    let client = client(false).unwrap();
    let r = tauri::async_runtime::block_on(download_file_within(
        &client,
        &s.url,
        data.len() as u64,
        &sha(&data),
        &dest,
        &AtomicBool::new(false),
        &mut noop,
        Duration::from_millis(100),
    ));
    assert!(matches!(&r, Err(AudioError::Download { message }) if message.contains("longer than")), "{r:?}");
    assert!(!dest.exists());
    assert!(part_path(&dest).exists(), "kept for a later resume");
    assert_eq!(DEADLINE, Duration::from_secs(1800));
}

#[cfg(unix)]
#[test]
fn a_link_at_the_part_name_is_replaced_not_followed() {
    let data = body(5000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let (target, dest) = (dir.path().join("target.txt"), dir.path().join("file.bin"));
    fs::write(&target, "precious").unwrap();
    std::os::unix::fs::symlink(&target, part_path(&dest)).unwrap();
    let (r, _) = run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    assert_eq!(fs::read_to_string(&target).unwrap(), "precious", "nothing was written through the link");
    assert_eq!(fs::read(&dest).unwrap(), data);
}

#[test]
fn disk_full_is_told_apart_from_other_write_errors() {
    use std::io::ErrorKind::*;
    assert_eq!(io_err(std::io::Error::from(StorageFull)), AudioError::DiskFull);
    assert_eq!(io_err(std::io::Error::from(QuotaExceeded)), AudioError::DiskFull);
    assert!(matches!(io_err(std::io::Error::from(PermissionDenied)), AudioError::Other { .. }));
}

#[test]
fn the_app_client_builds_and_only_follows_a_few_https_redirects() {
    assert!(build_client().is_ok());
    assert!(follow_redirect(0, "https", true) && follow_redirect(5, "https", true));
    assert!(!follow_redirect(6, "https", true) && !follow_redirect(0, "http", true));
    assert!(follow_redirect(0, "http", false) && !follow_redirect(6, "http", false));
}

#[test]
fn a_redirect_is_followed_and_a_redirect_loop_is_stopped() {
    let data = body(20_000);
    let dir = tempfile::tempdir().unwrap();
    let (r, _) = run(&serve(data.clone(), Mode::Redirect).url, &data, &sha(&data), &dir.path().join("a.bin"), &AtomicBool::new(false));
    assert_eq!(r, Ok(()));
    let (r, _) = run(&serve(data.clone(), Mode::RedirectLoop).url, &data, &sha(&data), &dir.path().join("b.bin"), &AtomicBool::new(false));
    assert!(matches!(&r, Err(AudioError::Download { message }) if message.contains("302")), "{r:?}");
}

#[test]
fn more_data_than_announced_is_refused_and_the_part_file_removed() {
    let data = body(10_000);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    let client = client(false).unwrap();
    let s = serve(data.clone(), Mode::Unannounced);
    let r = tauri::async_runtime::block_on(download_file(&client, &s.url, 4_000, &sha(&data), &dest, &AtomicBool::new(false), &mut noop));
    assert!(matches!(&r, Err(AudioError::Download { message }) if message.contains("more data")), "{r:?}");
    assert!(!dest.exists() && !part_path(&dest).exists());
}

#[test]
fn a_body_that_ends_early_without_an_error_is_reported_with_its_size() {
    let data = body(10_000);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    let (r, _) = run(&serve(data.clone(), Mode::UnannouncedHalf).url, &data, &sha(&data), &dest, &AtomicBool::new(false));
    assert!(matches!(&r, Err(AudioError::Download { message }) if message.contains("ended early") && message.contains("of 10000")), "{r:?}");
    assert_eq!(fs::metadata(part_path(&dest)).unwrap().len(), 5_000);
}

#[test]
fn a_cancel_is_honoured_even_when_the_part_file_is_already_complete() {
    let data = body(3_000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("file.bin");
    fs::write(part_path(&dest), &data).unwrap();
    let (r, _) = run(&s.url, &data, &sha(&data), &dest, &AtomicBool::new(true));
    assert_eq!(r, Err(AudioError::Cancelled));
    assert!(s.requests.lock().unwrap().is_empty() && !dest.exists());
}

#[test]
fn a_pack_downloads_every_file_and_reports_progress_over_the_whole_pack() {
    let data = body(4_000);
    let s = serve(data.clone(), Mode::Normal);
    let pack = stub_pack("stub", &[], &s.url, &data, &["a/one.bin", "two.bin"]);
    let dir = tempfile::tempdir().unwrap();
    let seen = Mutex::new(Vec::new());
    let r =
        tauri::async_runtime::block_on(download_pack(&client(false).unwrap(), pack, dir.path(), &AtomicBool::new(false), &|p| seen.lock().unwrap().push(p)));
    assert_eq!(r, Ok(()));
    assert!(pack.installed(dir.path()));
    let seen = seen.into_inner().unwrap();
    assert!(seen.iter().all(|p| p.total == 8_000) && seen.windows(2).all(|w| w[0].done <= w[1].done));
    assert_eq!(seen.last().map(|p| p.done), Some(8_000));
    // a second run finds everything installed and reports the full size without asking the server again
    let asked = s.requests.lock().unwrap().len();
    assert_eq!(tauri::async_runtime::block_on(download_pack(&client(false).unwrap(), pack, dir.path(), &AtomicBool::new(false), &ignore_progress)), Ok(()));
    assert_eq!(s.requests.lock().unwrap().len(), asked);
    // a failing file stops the pack with its error
    let bad = serve(data.clone(), Mode::Status(500));
    let broken = stub_pack("broken", &[], &bad.url, &data, &["x.bin"]);
    let r = tauri::async_runtime::block_on(download_pack(&client(false).unwrap(), broken, dir.path(), &AtomicBool::new(false), &ignore_progress));
    assert!(matches!(r, Err(AudioError::Download { .. })));
}

/// Fetches `files` (the small ones of the catalog) and checks their hashes: with `enabled` only, which the tests set
/// from `CADABRA_NET_TESTS=1`. `https_only` is false only for the loopback stand-in.
fn fetch_small_files(enabled: bool, https_only: bool, files: &[&RemoteFile], expected: usize) {
    if !enabled {
        eprintln!("skipping: set CADABRA_NET_TESTS=1 to download the small voice files");
        return;
    }
    let client = client(https_only).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let count = AtomicUsize::new(0);
    for f in files {
        let r = tauri::async_runtime::block_on(download_file(&client, f.url, f.size, f.sha256, &dir.path().join(f.rel), &AtomicBool::new(false), &mut noop));
        assert_eq!(r, Ok(()), "{}", f.rel);
        count.fetch_add(1, Ordering::Relaxed);
    }
    assert_eq!(count.load(Ordering::Relaxed), expected);
}

/// Hits the real servers for the small files only (a few KB), to prove the pinned URLs, redirects, TLS and hashes
/// work. Opt in with `CADABRA_NET_TESTS=1`; it never runs by default, so tests need no network.
#[test]
fn real_servers_serve_the_pinned_small_files() {
    let small: Vec<&RemoteFile> = PACKS.iter().flat_map(|p| p.files).filter(|f| f.size < 100_000).collect();
    fetch_small_files(std::env::var("CADABRA_NET_TESTS").as_deref() == Ok("1"), true, &small, 3);
}

#[test]
fn the_small_file_check_works_against_a_loopback_server() {
    let data = body(2_000);
    let s = serve(data.clone(), Mode::Normal);
    let pack = stub_pack("stub", &[], &s.url, &data, &["a.bin", "b.bin", "c.bin"]);
    fetch_small_files(true, false, &pack.files.iter().collect::<Vec<_>>(), 3);
    fetch_small_files(false, true, &[], 0);
}

/// Downloads every pack of `packs` and renders a sentence with each of their voices through the engine `sherpa`, which
/// is the app's path end to end. Only when `enabled` (`CADABRA_NET_TESTS=full`); `https_only` is false only for the
/// loopback stand-in. Without an engine the download is still checked and the render skipped, unless `required`
/// (`REQUIRE_SHERPA=1`) makes the missing engine a failure.
fn download_packs_and_speak(enabled: bool, https_only: bool, packs: &[&Pack], sherpa: Result<PathBuf, AudioError>, required: bool, min_secs: f64) {
    if !enabled {
        eprintln!("skipping: set CADABRA_NET_TESTS=full to download the voice packs");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let (voices, book) = (dir.path().join("voices"), dir.path().join("book"));
    fs::create_dir_all(&book).unwrap();
    fs::write(book.join("cadabra.json"), "{}").unwrap();
    let client = client(https_only).unwrap();
    assert!(!packs.is_empty(), "CADABRA_NET_PACKS names no pack");
    for pack in packs {
        let last = Mutex::new(0u64);
        let r = tauri::async_runtime::block_on(download_pack(&client, pack, &voices, &AtomicBool::new(false), &|p| *last.lock().unwrap() = p.done));
        assert_eq!(r, Ok(()), "{}", pack.id);
        assert_eq!(*last.lock().unwrap(), pack.bytes());
        assert!(pack.installed(&voices));
    }
    let expected: Vec<&str> = packs.iter().flat_map(|p| p.voices.iter().copied()).collect();
    assert_eq!(crate::audio::voices::list_voices(Some(&voices)).iter().filter(|v| v.installed).count(), expected.len());
    let Ok(bin) = sherpa else {
        assert!(!required, "REQUIRE_SHERPA=1 but the voice engine was not found");
        eprintln!("downloaded; skipping the render: no engine (SHERPA_TTS_BIN)");
        return;
    };
    for voice in crate::audio::voices::VOICES.iter().filter(|v| expected.contains(&v.id)) {
        let req = crate::audio::render::ChapterRequest {
            job_id: "dl".into(),
            root: book.to_string_lossy().into_owned(),
            base: format!("exports/audio/{}", voice.id),
            chunks: vec![crate::audio::batch::Chunk { text: "The quay was empty. A gull cried once.".into(), pause_after_ms: 600 }],
            voice: voice.id.into(),
            speed: 1.0,
            formats: vec!["opus".into(), "flac".into()],
            part: None,
            language: None,
        };
        let done = crate::audio::render::render_chapter(&req, &bin, Some(&voices), &AtomicBool::new(false), &|_| {}).unwrap();
        assert!(done.duration_sec > min_secs && done.duration_sec < 30.0, "{}: {}", voice.id, done.duration_sec);
        assert!(book.join(format!("exports/audio/{}.opus", voice.id)).is_file());
    }
}

/// Downloads every pack (about 510 MB; `CADABRA_NET_PACKS=piper` limits it to one pack, 148 MB) and renders a sentence
/// with each of their voices through the real engine, which is the app's path end to end. Opt in with
/// `CADABRA_NET_TESTS=full`, and `SHERPA_TTS_BIN` for the rendering (`REQUIRE_SHERPA=1` fails without it). CI runs it
/// with the bundled engine.
#[test]
fn real_packs_download_and_then_speak() {
    let packs = selected_packs(std::env::var("CADABRA_NET_PACKS").ok().as_deref());
    let required = std::env::var("REQUIRE_SHERPA").as_deref() == Ok("1");
    download_packs_and_speak(std::env::var("CADABRA_NET_TESTS").as_deref() == Ok("full"), true, &packs, crate::audio::engine::find_sherpa(), required, 1.0);
}

/// The packs `CADABRA_NET_PACKS` names (all of them when it is not set).
fn selected_packs(only: Option<&str>) -> Vec<&'static Pack> {
    PACKS.iter().filter(|p| only.is_none_or(|o| o == p.id)).collect()
}

#[test]
fn one_pack_can_be_selected_for_the_download_check() {
    assert_eq!(selected_packs(None).len(), PACKS.len());
    assert_eq!(selected_packs(Some("piper")).iter().map(|p| p.id).collect::<Vec<_>>(), vec!["piper"]);
    assert!(selected_packs(Some("nope")).is_empty());
}

#[test]
fn the_pack_check_works_against_a_loopback_server_with_and_without_an_engine() {
    let data = body(3_000);
    let s = serve(data.clone(), Mode::Normal);
    // the files piper-amy needs, so that its voice counts as installed
    let pack = stub_pack(
        "stub",
        &["piper-amy"],
        &s.url,
        &data,
        &["vits-piper-en_US-amy-low/en_US-amy-low.onnx", "vits-piper-en_US-amy-low/tokens.txt", "lexicon-en-us.txt"],
    );
    let none = || Err(AudioError::NotFound { message: "no engine".into() });
    download_packs_and_speak(false, true, &[], none(), false, 1.0);
    download_packs_and_speak(true, false, &[pack], none(), false, 1.0);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let wav = dir.path().join("two-seconds.wav");
        fs::write(&wav, crate::audio::wav::write_wav(24000, &vec![1000i16; 48_000]).unwrap()).unwrap();
        let engine = dir.path().join("fake-engine");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\nfor a in \"$@\"; do case \"$a\" in --output-filename=*) out=\"${{a#--output-filename=}}\";; esac; done\ncp '{}' \"$out\"\n",
                wav.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o755)).unwrap();
        download_packs_and_speak(true, false, &[pack], Ok(engine), false, 1.5);
    }
}

#[test]
#[should_panic(expected = "names no pack")]
fn an_empty_pack_selection_is_reported() {
    download_packs_and_speak(true, false, &[], Err(AudioError::Cancelled), false, 1.0);
}

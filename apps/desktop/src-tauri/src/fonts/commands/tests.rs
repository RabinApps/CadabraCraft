use super::*;
use crate::audio::download::{client, stub};
use crate::audio::error::AudioError;
use crate::commands::testutil::{raw, run, text};
use crate::fonts::catalog::RemoteFile;
use crate::fonts::import::tests::ttf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

fn stub_client() -> Result<reqwest::Client, AudioError> {
    client(false)
}

fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

/// A family whose files and licence are all `data` served from `url`.
fn stub_family(id: &'static str, url: &str, data: &[u8], names: &[&'static str]) -> &'static Family {
    let (url, sha) = (leak(url.to_string()), leak(stub::sha(data)));
    let file = |name| RemoteFile { name, url, size: data.len() as u64, sha256: sha };
    let files: Vec<RemoteFile> = names.iter().map(|n| file(*n)).collect();
    let styles: Vec<&'static str> = names.iter().map(|_| "Regular").collect();
    Box::leak(Box::new(Family {
        id,
        family: "Stub",
        styles: Box::leak(styles.into_boxed_slice()),
        files: Box::leak(files.into_boxed_slice()),
        licence: file("OFL.txt"),
    }))
}

fn collect<T>() -> (Channel<T>, Arc<Mutex<Vec<String>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let channel = Channel::new(move |body| {
        log.lock().unwrap().push(text(body));
        Ok(())
    });
    (channel, seen)
}

#[test]
fn a_download_writes_every_file_and_the_licence_verified_and_reports_family_progress() {
    let data = stub::body(5_000);
    let server = stub::serve(data.clone(), stub::Mode::Normal);
    let family = stub_family("stub", &server.url, &data, &["One-Regular.ttf", "One-Italic.ttf"]);
    let (jobs, root) = (AudioJobs::default(), tempfile::tempdir().unwrap());
    let (progress, seen) = collect::<DownloadProgress>();
    run(download_job(&jobs, Some(family), "stub", "dl".into(), progress, Some(root.path().to_path_buf()), stub_client)).unwrap();
    assert!(family.installed(root.path()));
    for name in ["One-Regular.ttf", "One-Italic.ttf", "OFL.txt"] {
        assert_eq!(std::fs::read(root.path().join("stub").join(name)).unwrap(), data);
    }
    assert_eq!(std::fs::read_dir(root.path().join("stub")).unwrap().count(), 3, "no .part files remain");
    assert_eq!(seen.lock().unwrap().last().map(String::as_str), Some(r#"{"done":15000,"total":15000}"#));
    // a second run has nothing to fetch
    let before = server.requests.lock().unwrap().len();
    let (progress, _) = collect::<DownloadProgress>();
    run(download_job(&jobs, Some(family), "stub", "dl2".into(), progress, Some(root.path().to_path_buf()), stub_client)).unwrap();
    assert_eq!(server.requests.lock().unwrap().len(), before);
}

#[test]
fn a_wrong_hash_is_a_checksum_error_and_the_file_is_deleted() {
    let data = stub::body(3_000);
    let server = stub::serve(stub::body(3_000).iter().map(|b| b ^ 1).collect(), stub::Mode::Normal);
    let family = stub_family("stub-bad", &server.url, &data, &["Bad.ttf"]);
    let (jobs, root) = (AudioJobs::default(), tempfile::tempdir().unwrap());
    let (progress, _) = collect::<DownloadProgress>();
    let r = run(download_job(&jobs, Some(family), "stub-bad", "x".into(), progress, Some(root.path().to_path_buf()), stub_client));
    assert_eq!(r, Err(FontError::Checksum { file: "Bad.ttf".into() }));
    assert!(!root.path().join("stub-bad/Bad.ttf").exists() && !root.path().join("stub-bad/Bad.ttf.part").exists());
    assert!(!family.installed(root.path()));
}

#[test]
fn a_cancelled_download_keeps_the_part_file_and_the_next_run_resumes_it() {
    let data = stub::body(300_000);
    let server = stub::serve(data.clone(), stub::Mode::Normal);
    let family = stub_family("stub-resume", &server.url, &data, &["R.ttf"]);
    let (jobs, root) = (AudioJobs::default(), tempfile::tempdir().unwrap());
    // the flag of a job id that was cancelled before (or during) the run stops it
    jobs.cancel("stop");
    let (progress, _) = collect::<DownloadProgress>();
    let r = run(download_job(&jobs, Some(family), "stub-resume", "stop".into(), progress, Some(root.path().to_path_buf()), stub_client));
    assert_eq!(r, Err(FontError::Cancelled));
    assert!(!family.installed(root.path()));
    // leave half of the file as a partial download, then run again: only the rest is requested
    std::fs::write(root.path().join("stub-resume/R.ttf.part"), &data[..100_000]).unwrap();
    let (progress, _) = collect::<DownloadProgress>();
    run(download_job(&jobs, Some(family), "stub-resume", "go".into(), progress, Some(root.path().to_path_buf()), stub_client)).unwrap();
    assert_eq!(std::fs::read(root.path().join("stub-resume/R.ttf")).unwrap(), data);
    assert!(server.requests.lock().unwrap().iter().any(|r| r.as_deref() == Some("bytes=100000-")), "{:?}", server.requests.lock().unwrap());
    assert!(!jobs.flag("go").load(Ordering::Relaxed));
}

#[test]
fn cancelling_while_the_server_is_slow_stops_the_download() {
    let data = stub::body(400_000);
    let server = stub::serve(data.clone(), stub::Mode::Slow);
    let family = stub_family("stub-slow", &server.url, &data, &["S.ttf"]);
    let (jobs, root) = (Arc::new(AudioJobs::default()), tempfile::tempdir().unwrap());
    let stopper = jobs.clone();
    let handle = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        stopper.cancel("slow");
    });
    let (progress, _) = collect::<DownloadProgress>();
    let r = run(download_job(&jobs, Some(family), "stub-slow", "slow".into(), progress, Some(root.path().to_path_buf()), stub_client));
    handle.join().unwrap();
    assert_eq!(r, Err(FontError::Cancelled));
    assert!(!root.path().join("stub-slow/S.ttf").exists());
}

#[test]
fn a_second_download_of_a_family_that_is_running_is_refused_and_the_mark_is_released() {
    let data = stub::body(100);
    let family = stub_family("stub-busy", "http://127.0.0.1:1/x", &data, &["B.ttf"]);
    let (jobs, root) = (AudioJobs::default(), tempfile::tempdir().unwrap());
    let running = jobs.begin_download("font:stub-busy").unwrap();
    let (progress, _) = collect::<DownloadProgress>();
    let r = run(download_job(&jobs, Some(family), "stub-busy", "x".into(), progress, Some(root.path().to_path_buf()), stub_client));
    assert!(matches!(r, Err(FontError::Other { message }) if message.contains("already downloading")));
    drop(running);
    // a failed run (the server is not there) is a network error and does not leave the family marked as running
    let (progress, _) = collect::<DownloadProgress>();
    let r = run(download_job(&jobs, Some(family), "stub-busy", "x".into(), progress, Some(root.path().to_path_buf()), stub_client));
    assert!(matches!(r, Err(FontError::Network { .. })), "{r:?}");
    assert!(jobs.begin_download("font:stub-busy").is_some());
    // a voice pack with the same name is a different download
    assert!(jobs.begin_download("stub-busy").is_some());
}

#[test]
fn a_download_is_refused_for_an_unknown_font_without_a_folder_or_with_a_client_that_cannot_be_built() {
    let data = stub::body(100);
    let family = stub_family("stub-refuse", "http://127.0.0.1:1/x", &data, &["B.ttf"]);
    let (jobs, root) = (AudioJobs::default(), tempfile::tempdir().unwrap());
    let (progress, _) = collect::<DownloadProgress>();
    assert_eq!(
        run(download_job(&jobs, None, "nope", "x".into(), progress, Some(root.path().to_path_buf()), stub_client)),
        Err(FontError::UnknownFont { font: "nope".into() })
    );
    let (progress, _) = collect::<DownloadProgress>();
    assert!(
        matches!(run(download_job(&jobs, Some(family), "stub-refuse", "x".into(), progress, None, stub_client)), Err(FontError::Other { message }) if message.contains("no folder for fonts"))
    );
    let (progress, _) = collect::<DownloadProgress>();
    assert_eq!(
        run(download_job(&jobs, Some(family), "stub-refuse", "x".into(), progress, Some(root.path().to_path_buf()), || Err(AudioError::DiskFull))),
        Err(FontError::DiskFull)
    );
    assert_eq!(run(fonts_download_unknown()), Err(FontError::UnknownFont { font: "nope".into() }));
}

/// The catalog lookup of the real command refuses an id that is not in it.
async fn fonts_download_unknown() -> Result<(), FontError> {
    let (progress, _) = collect::<DownloadProgress>();
    download_job(&AudioJobs::default(), find_family("nope"), "nope", "x".into(), progress, None, build_client).await
}

#[test]
fn a_server_error_is_a_network_error() {
    let data = stub::body(100);
    let server = stub::serve(Vec::new(), stub::Mode::Status(404));
    let family = stub_family("stub-404", &server.url, &data, &["B.ttf"]);
    let (jobs, root) = (AudioJobs::default(), tempfile::tempdir().unwrap());
    let (progress, _) = collect::<DownloadProgress>();
    let r = run(download_job(&jobs, Some(family), "stub-404", "x".into(), progress, Some(root.path().to_path_buf()), stub_client));
    assert!(matches!(r, Err(FontError::Network { ref message }) if message.contains("404")), "{r:?}");
}

#[test]
fn the_real_client_refuses_plain_http() {
    let data = stub::body(100);
    let server = stub::serve(data.clone(), stub::Mode::Normal);
    let family = stub_family("stub-http", &server.url, &data, &["H.ttf"]);
    let (jobs, root) = (AudioJobs::default(), tempfile::tempdir().unwrap());
    let (progress, _) = collect::<DownloadProgress>();
    let r = run(download_job(&jobs, Some(family), "stub-http", "x".into(), progress, Some(root.path().to_path_buf()), build_client));
    assert!(matches!(r, Err(FontError::Network { .. })), "{r:?}");
}

#[test]
fn a_picked_font_file_is_imported_into_the_fonts_folder() {
    use tauri::Manager;
    // The folder is the startup setting (set once for the whole test process) or CADABRA_FONTS_DIR.
    crate::fonts::set_fonts_dir(std::env::temp_dir().join("cadabracraft-test-fonts"));
    let src = tempfile::tempdir().unwrap();
    let font = src.path().join("Picked.ttf");
    std::fs::write(&font, ttf("Picked Family")).unwrap();
    let app = tauri::test::mock_app();
    app.manage(PickedPaths::default());
    app.state::<PickedPaths>().record(PickKind::Font, &font).unwrap();
    let installed = run(fonts_import(app.state(), font.to_string_lossy().into_owned())).unwrap();
    assert_eq!(installed.family, "Picked Family");
}

#[test]
fn the_commands_list_the_catalog_and_installed_fonts_import_read_and_delete() {
    // These commands read the fonts folder from CADABRA_FONTS_DIR or the startup setting, so only the
    // folder-independent parts run here; the folder logic is covered by the store and import tests.
    assert!(run(fonts_catalog()).unwrap().len() >= 35);
    let _ = run(fonts_installed()).unwrap();
    assert!(matches!(require_root(None), Err(FontError::Other { message }) if message.contains("no folder for fonts")));
    let src = tempfile::tempdir().unwrap();
    let woff = src.path().join("a.woff2");
    std::fs::write(&woff, ttf("X")).unwrap();
    let picked = PickedPaths::default();
    assert!(matches!(picked_font(&picked, &woff.to_string_lossy()), Err(FontError::InvalidFont { .. })), "not picked");
    picked.record(PickKind::Image, &woff).unwrap();
    assert!(picked_font(&picked, &woff.to_string_lossy()).is_err(), "picked for another purpose");
    picked.record(PickKind::Font, &woff).unwrap();
    assert_eq!(picked_font(&picked, &woff.to_string_lossy()).unwrap(), woff.canonicalize().unwrap());
    assert!(picked_font(&picked, "/no/such/font.ttf").is_err());
    assert!(matches!(run(fonts_delete("../x".into())), Err(FontError::UnknownFont { .. }) | Err(FontError::Other { .. })));
    assert!(run(fonts_data("lora".into(), "../x.ttf".into())).is_err());
    let _ = raw; // (raw responses are exercised through the store tests)
}

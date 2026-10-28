//! Downloads the voice files the audiobook export needs. This is the one place besides the update check where the app
//! uses the network, and only after the author clicks "Download" in the Export dialog. Every file is a pinned URL
//! (a Hugging Face commit or a GitHub release asset) with a pinned size and sha256: a file that does not match is
//! deleted and never used. Downloads go to `<name>.part` first and are renamed only after the hash matches, so a
//! half-written voice is never mistaken for an installed one, and a stopped or failed download resumes from where it
//! left off (HTTP `Range`). Cancel is a flag checked between chunks, so it takes effect within one network read.
//!
//! Threading: the commands are `async` and run on Tauri's async runtime; network reads await, and each chunk's file
//! write and hash are a few microseconds, so no worker thread is held for the duration.
use super::error::{other, AudioError};
use super::packs::Pack;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub(crate) fn io_err(e: std::io::Error) -> AudioError {
    use std::io::ErrorKind::*;
    match e.kind() {
        StorageFull | QuotaExceeded => AudioError::DiskFull,
        _ => other(e),
    }
}

fn net_err(e: reqwest::Error) -> AudioError {
    AudioError::Download { message: e.without_url().to_string() }
}

/// An HTTPS-only client (redirects too: a download that is sent to plain HTTP is refused), with timeouts so a dead
/// connection fails instead of hanging. The updater plugin installs the `ring` crypto provider lazily when it checks for
/// updates; install it here too, so a download works before any update check.
pub fn build_client() -> Result<reqwest::Client, AudioError> {
    client(true)
}

/// `https_only` is always true in the app; the tests turn it off to talk to a loopback server.
pub(crate) fn client(https_only: bool) -> Result<reqwest::Client, AudioError> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(concat!("CadabraCraft/", env!("CARGO_PKG_VERSION")))
        .https_only(https_only)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(move |a| if follow_redirect(a.previous().len(), a.url().scheme(), https_only) { a.follow() } else { a.stop() }))
        .build()
        .map_err(net_err)
}

/// Whether to follow a redirect: at most 6 hops, and (in the app) only to HTTPS.
fn follow_redirect(previous: usize, scheme: &str, https_only: bool) -> bool {
    previous < 6 && (scheme == "https" || !https_only)
}

pub(crate) fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".part");
    dest.with_file_name(name)
}

fn hex(h: Sha256) -> String {
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads `url` to `dest`, resuming a `.part` file when the server honours `Range`, and renames it into place only
/// when its size and sha256 match. `progress` receives the bytes of this file present so far (including resumed ones).
/// Cancel leaves the `.part` file for a later resume; a hash mismatch deletes it.
pub async fn download_file(client: &reqwest::Client, url: &str, size: u64, sha256: &str, dest: &Path, cancel: &AtomicBool, progress: &mut (dyn FnMut(u64) + Send)) -> Result<(), AudioError> {
    if fs::metadata(dest).is_ok_and(|m| m.is_file() && m.len() == size) {
        progress(size);
        return Ok(());
    }
    let part = part_path(dest);
    fs::create_dir_all(dest.parent().unwrap_or(Path::new(""))).map_err(io_err)?; // "" (a bare file name) is a no-op
    let (mut hasher, mut have) = (Sha256::new(), 0u64);
    if let Ok(md) = fs::metadata(&part) {
        if md.is_file() && md.len() <= size {
            let mut f = File::open(&part).map_err(io_err)?;
            let mut buf = vec![0u8; 1 << 20];
            loop {
                let n = f.read(&mut buf).map_err(io_err)?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                have += n as u64;
            }
        } else {
            let _ = fs::remove_file(&part);
        }
    }

    if have < size {
        let mut req = client.get(url);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut resp = req.send().await.map_err(net_err)?;
        let status = resp.status();
        let append = match status.as_u16() {
            206 => true,
            200 => {
                if have > 0 {
                    (hasher, have) = (Sha256::new(), 0); // the server ignored Range: start over
                }
                false
            }
            code => return Err(AudioError::Download { message: format!("the server answered {code}") }),
        };
        if let Some(len) = resp.content_length() {
            if len != size - have {
                return Err(AudioError::Download { message: format!("the server offered {len} bytes, expected {}", size - have) });
            }
        }
        let mut out = OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(&part).map_err(io_err)?;
        let mut last = Instant::now();
        progress(have);
        while let Some(chunk) = resp.chunk().await.map_err(net_err)? {
            if cancel.load(Ordering::Relaxed) {
                return Err(AudioError::Cancelled);
            }
            if have + chunk.len() as u64 > size {
                let _ = fs::remove_file(&part);
                return Err(AudioError::Download { message: "the server sent more data than expected".into() });
            }
            out.write_all(&chunk).map_err(io_err)?;
            hasher.update(&chunk);
            have += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(150) {
                progress(have);
                last = Instant::now();
            }
        }
        out.flush().map_err(io_err)?;
        out.sync_all().map_err(io_err)?;
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(AudioError::Cancelled);
    }
    if have != size {
        return Err(AudioError::Download { message: format!("the download ended early ({have} of {size} bytes)") });
    }
    progress(have);
    if hex(hasher) != sha256 {
        let _ = fs::remove_file(&part);
        return Err(AudioError::Checksum { file: dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() });
    }
    fs::rename(&part, dest).map_err(io_err)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// Bytes of the whole pack present so far.
    pub done: u64,
    pub total: u64,
}

/// Downloads every file of `pack` that is not installed yet, one after another.
pub async fn download_pack(client: &reqwest::Client, pack: &Pack, root: &Path, cancel: &AtomicBool, on_progress: &(dyn Fn(DownloadProgress) + Send + Sync)) -> Result<(), AudioError> {
    let total = pack.bytes();
    let mut before = 0u64;
    for f in pack.files {
        download_file(client, f.url, f.size, f.sha256, &root.join(f.rel), cancel, &mut |n| on_progress(DownloadProgress { done: before + n, total })).await?;
        before += f.size;
    }
    Ok(())
}

/// A loopback HTTP server for the download tests (and the command tests), so nothing here touches the network.
#[cfg(test)]
pub(crate) mod stub {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use crate::audio::packs::{Pack, RemoteFile};
    use sha2::{Digest, Sha256};

    #[derive(Clone, Copy, PartialEq)]
    pub(crate) enum Mode {
        Normal,
        IgnoreRange,
        Status(u16),
        /// Announces the whole body, sends half and closes.
        Truncate,
        /// Sends the body slowly, so a test can cancel half-way.
        Slow,
        /// Answers `/file.bin` with a redirect to `/moved.bin`, which serves the body.
        Redirect,
        /// Redirects to itself forever.
        RedirectLoop,
        /// No `Content-Length`: the body ends when the connection closes. Sends the whole body.
        Unannounced,
        /// Like `Unannounced`, but closes after half of the body.
        UnannouncedHalf,
    }

    pub(crate) struct Server {
        pub url: String,
        pub requests: Arc<Mutex<Vec<Option<String>>>>,
    }

    /// A tiny HTTP/1.1 server on a loopback port that serves `body` (with `Range` support) to every connection.
    pub(crate) fn serve(body: Vec<u8>, mode: Mode) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (body, seen) = (body.clone(), seen.clone());
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    let mut range = None;
                    let mut line = String::new();
                    let _ = reader.read_line(&mut line);
                    let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
                    line.clear();
                    while reader.read_line(&mut line).is_ok() && line.trim() != "" {
                        if line.to_lowercase().starts_with("range:") {
                            range = Some(line.split_once(':').unwrap().1.trim().to_string());
                        }
                        line.clear();
                    }
                    seen.lock().unwrap().push(range.clone());
                    let mut out = stream;
                    if let Mode::Status(code) = mode {
                        let _ = write!(out, "HTTP/1.1 {code} Nope\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        return;
                    }
                    if mode == Mode::RedirectLoop || (mode == Mode::Redirect && path == "/file.bin") {
                        let to = if mode == Mode::Redirect { "/moved.bin" } else { "/file.bin" };
                        let _ = write!(out, "HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        return;
                    }
                    let start = match (&range, mode) {
                        (Some(r), m) if m != Mode::IgnoreRange => r.trim_start_matches("bytes=").trim_end_matches('-').parse::<usize>().unwrap(),
                        _ => 0,
                    };
                    let slice = &body[start..];
                    let head = if start > 0 {
                        format!("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{}/{}\r\n", body.len() - 1, body.len())
                    } else {
                        "HTTP/1.1 200 OK\r\n".to_string()
                    };
                    let unannounced = matches!(mode, Mode::Unannounced | Mode::UnannouncedHalf);
                    let length = if unannounced { String::new() } else { format!("Content-Length: {}\r\n", slice.len()) };
                    let _ = write!(out, "{head}{length}Connection: close\r\n\r\n");
                    let send = if matches!(mode, Mode::Truncate | Mode::UnannouncedHalf) { &slice[..slice.len() / 2] } else { slice };
                    for piece in send.chunks(8192) {
                        if out.write_all(piece).is_err() {
                            return;
                        }
                        if mode == Mode::Slow {
                            std::thread::sleep(Duration::from_millis(30));
                        }
                    }
                });
            }
        });
        Server { url, requests }
    }

    pub(crate) fn body(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i * 31 % 251) as u8).collect()
    }

    /// A catalog entry for `url`, as the real catalog has them (static strings), with `rels` all serving `data`.
    pub(crate) fn stub_pack(id: &'static str, voices: &'static [&'static str], url: &str, data: &[u8], rels: &[&'static str]) -> &'static Pack {
        let (url, sha): (&'static str, &'static str) = (Box::leak(url.to_string().into_boxed_str()), Box::leak(sha(data).into_boxed_str()));
        let files: Vec<RemoteFile> = rels.iter().map(|rel| RemoteFile { rel, url, size: data.len() as u64, sha256: sha }).collect();
        Box::leak(Box::new(Pack { id, voices, files: Box::leak(files.into_boxed_slice()) }))
    }

    pub(crate) fn sha(b: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(b);
        super::hex(h)
    }

}

#[cfg(test)]
mod tests {
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
        let r = tauri::async_runtime::block_on(download_pack(&client(false).unwrap(), pack, dir.path(), &AtomicBool::new(false), &|p| seen.lock().unwrap().push(p)));
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
    /// loopback stand-in. Without an engine the download is still checked and the render skipped.
    fn download_packs_and_speak(enabled: bool, https_only: bool, packs: &[&Pack], sherpa: Result<PathBuf, AudioError>, min_secs: f64) {
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
            eprintln!("downloaded; skipping the render: no engine (SHERPA_TTS_BIN)");
            return;
        };
        for voice in crate::audio::voices::VOICES.iter().filter(|v| expected.contains(&v.id)) {
            let req = crate::audio::render::ChapterRequest { job_id: "dl".into(), root: book.to_string_lossy().into_owned(), base: format!("exports/audio/{}", voice.id), chunks: vec![crate::audio::batch::Chunk { text: "The quay was empty. A gull cried once.".into(), pause_after_ms: 600 }], voice: voice.id.into(), speed: 1.0, formats: vec!["opus".into(), "flac".into()], part: None };
            let done = crate::audio::render::render_chapter(&req, &bin, Some(&voices), &AtomicBool::new(false), &|_| {}).unwrap();
            assert!(done.duration_sec > min_secs && done.duration_sec < 30.0, "{}: {}", voice.id, done.duration_sec);
            assert!(book.join(format!("exports/audio/{}.opus", voice.id)).is_file());
        }
    }

    /// Downloads every pack (about 510 MB; `CADABRA_NET_PACKS=piper` limits it to one pack, 148 MB) and renders a sentence
    /// with each of their voices through the real engine, which is the app's path end to end. Opt in with
    /// `CADABRA_NET_TESTS=full`, and `SHERPA_TTS_BIN` for the rendering. CI runs it with the bundled engine.
    #[test]
    fn real_packs_download_and_then_speak() {
        let packs = selected_packs(std::env::var("CADABRA_NET_PACKS").ok().as_deref());
        download_packs_and_speak(std::env::var("CADABRA_NET_TESTS").as_deref() == Ok("full"), true, &packs, crate::audio::engine::find_sherpa(), 1.0);
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
        let pack = stub_pack("stub", &["piper-amy"], &s.url, &data, &["vits-piper-en_US-amy-low/en_US-amy-low.onnx", "vits-piper-en_US-amy-low/tokens.txt", "lexicon-en-us.txt"]);
        let none = || Err(AudioError::NotFound { message: "no engine".into() });
        download_packs_and_speak(false, true, &[], none(), 1.0);
        download_packs_and_speak(true, false, &[pack], none(), 1.0);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = tempfile::tempdir().unwrap();
            let wav = dir.path().join("two-seconds.wav");
            fs::write(&wav, crate::audio::wav::write_wav(24000, &vec![1000i16; 48_000])).unwrap();
            let engine = dir.path().join("fake-engine");
            fs::write(&engine, format!("#!/bin/sh\nfor a in \"$@\"; do case \"$a\" in --output-filename=*) out=\"${{a#--output-filename=}}\";; esac; done\ncp '{}' \"$out\"\n", wav.display())).unwrap();
            fs::set_permissions(&engine, fs::Permissions::from_mode(0o755)).unwrap();
            download_packs_and_speak(true, false, &[pack], Ok(engine), 1.5);
        }
    }

    #[test]
    #[should_panic(expected = "names no pack")]
    fn an_empty_pack_selection_is_reported() {
        download_packs_and_speak(true, false, &[], Err(AudioError::Cancelled), 1.0);
    }
}

//! Downloads the voice files the audiobook export needs. This is the one place besides the update check where the app
//! uses the network, and only after the author clicks "Download" in the Export dialog. Every file is a pinned URL
//! (a Hugging Face commit or a GitHub release asset) with a pinned size and sha256: a file that does not match is
//! deleted and never used. Downloads go to `<name>.part` first and are renamed only after the hash matches, so a
//! half-written voice is never mistaken for an installed one, and a stopped or failed download resumes from where it
//! left off (HTTP `Range`). Cancel is a flag checked between chunks, so it takes effect within one network read.
//!
//! Threading: the commands are `async` and run on Tauri's async runtime; network reads await, and each chunk's file
//! write and hash are a few microseconds, so no worker thread is held for the duration.
use crate::audio::{other, voices_root, AudioError, AudioJobs};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub struct RemoteFile {
    /// Path under the voices folder (the layout `audio.rs` expects).
    pub rel: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

pub struct Pack {
    pub id: &'static str,
    /// Voice ids (`audio::VOICES`) this pack installs.
    pub voices: &'static [&'static str],
    pub files: &'static [RemoteFile],
}

/// A file of a Hugging Face repo at a pinned commit (never `main`, which can change under us).
macro_rules! hf {
    ($repo:literal, $commit:literal, $name:literal) => {
        concat!("https://huggingface.co/csukuangfj/", $repo, "/resolve/", $commit, "/", $name)
    };
}

macro_rules! file {
    ($rel:literal, $url:expr, $size:literal, $sha:literal) => {
        RemoteFile { rel: $rel, url: $url, size: $size, sha256: $sha }
    };
}

/// Sizes and hashes match the Hugging Face LFS metadata and the files the engine was tested with (docs/architecture.md).
pub const PACKS: &[Pack] = &[
    Pack {
        id: "piper",
        voices: &["piper-amy", "piper-libritts-0"],
        files: &[
            file!("vits-piper-en_US-amy-low/en_US-amy-low.onnx", hf!("vits-piper-en_US-amy-low", "76da6ca287517a49f58b943c4c4fdb0c1e94d61f", "en_US-amy-low.onnx"), 63104657, "8275b02c37c4ce6483b26a91704807e6de0c3f0bf8068e5d3b3598ab0da4253e"),
            file!("vits-piper-en_US-amy-low/tokens.txt", hf!("vits-piper-en_US-amy-low", "76da6ca287517a49f58b943c4c4fdb0c1e94d61f", "tokens.txt"), 763, "42d1a69ed2b91a51928a711aa228ed9f3dc021c6d359a3e9c4f37eb1d20f80bd"),
            file!("vits-piper-en_US-libritts_r-medium/en_US-libritts_r-medium.onnx", hf!("vits-piper-en_US-libritts_r-medium", "fe872db7e697e9f2a45d09328953f1fd2a9df630", "en_US-libritts_r-medium.onnx"), 78581047, "acd9425049d887a4d04681010c3b2ed143898b824e5bc1f2ef6ddaee4b11ad0e"),
            file!("vits-piper-en_US-libritts_r-medium/tokens.txt", hf!("vits-piper-en_US-libritts_r-medium", "fe872db7e697e9f2a45d09328953f1fd2a9df630", "tokens.txt"), 954, "620e1aecf1a68fea3ba5850d137b0138fa2037c9b372dad13b95a2a215d0849a"),
            file!("lexicon-en-us.txt", "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/lexicon-en-us.txt", 6305773, "8b67ae549a465eee78f92ecb74644ad90c3c58ce65f19c68baf85878a10ef73a"),
        ],
    },
    Pack {
        id: "kokoro",
        voices: &["kokoro-heart"],
        files: &[
            file!("kokoro-multi-lang-v1_0/model.onnx", hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "model.onnx"), 325560556, "b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11"),
            file!("kokoro-multi-lang-v1_0/voices.bin", hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "voices.bin"), 28200960, "1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29"),
            file!("kokoro-multi-lang-v1_0/tokens.txt", hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "tokens.txt"), 687, "6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425"),
            file!("kokoro-multi-lang-v1_0/lexicon-us-en.txt", hf!("kokoro-multi-lang-v1_0", "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b", "lexicon-us-en.txt"), 5956885, "7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14"),
        ],
    },
];

impl Pack {
    pub fn bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    /// Every file is there with exactly the pinned size. A file only gets its final name after its hash matched.
    pub fn installed(&self, root: &Path) -> bool {
        self.files.iter().all(|f| fs::metadata(root.join(f.rel)).is_ok_and(|m| m.is_file() && m.len() == f.size))
    }
}

pub fn find_pack(id: &str) -> Result<&'static Pack, AudioError> {
    PACKS.iter().find(|p| p.id == id).ok_or_else(|| other(format!("unknown voice pack {id:?}")))
}

fn io_err(e: std::io::Error) -> AudioError {
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
fn client(https_only: bool) -> Result<reqwest::Client, AudioError> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(concat!("CadabraCraft/", env!("CARGO_PKG_VERSION")))
        .https_only(https_only)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(|a| if a.previous().len() < 6 && a.url().scheme() == "https" { a.follow() } else { a.stop() }))
        .build()
        .map_err(net_err)
}

fn part_path(dest: &Path) -> PathBuf {
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
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(io_err)?;
    }
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

/// Removes the pack's files (and the folders they leave empty). Partial `.part` files are removed too.
pub fn delete_pack(pack: &Pack, root: &Path) -> Result<(), AudioError> {
    for f in pack.files {
        let path = root.join(f.rel);
        for p in [part_path(&path), path.clone()] {
            match fs::remove_file(&p) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(io_err(e)),
                _ => {}
            }
        }
        if let Some(dir) = path.parent().filter(|d| *d != root) {
            let _ = fs::remove_dir(dir); // only succeeds when empty
        }
    }
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: &'static str,
    pub voices: &'static [&'static str],
    /// Download size.
    pub bytes: u64,
    pub installed: bool,
}

pub fn list_packs(root: Option<&Path>) -> Vec<PackInfo> {
    PACKS.iter().map(|p| PackInfo { id: p.id, voices: p.voices, bytes: p.bytes(), installed: root.is_some_and(|r| p.installed(r)) }).collect()
}

fn require_root() -> Result<PathBuf, AudioError> {
    voices_root().ok_or_else(|| other("there is no folder for voices on this computer"))
}

#[tauri::command]
pub async fn audio_packs() -> Result<Vec<PackInfo>, AudioError> {
    crate::typst::blocking(|| Ok(list_packs(voices_root().as_deref()))).await
}

/// Downloads a voice pack. `on_progress` gets the bytes of the whole pack. Stop it with `audio_cancel(job_id)`; a stopped
/// or failed download resumes on the next call.
#[tauri::command]
pub async fn audio_download_pack(state: tauri::State<'_, AudioJobs>, pack: String, job_id: String, on_progress: tauri::ipc::Channel<DownloadProgress>) -> Result<(), AudioError> {
    let pack = find_pack(&pack)?;
    let root = require_root()?;
    let flag = state.flag(&job_id);
    let client = build_client()?;
    download_pack(&client, pack, &root, &flag, &|p| {
        let _ = on_progress.send(p);
    })
    .await
}

#[tauri::command]
pub async fn audio_delete_pack(pack: String) -> Result<(), AudioError> {
    let pack = find_pack(&pack)?;
    let root = require_root()?;
    crate::typst::blocking(move || delete_pack(pack, &root)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        Normal,
        IgnoreRange,
        Status(u16),
        /// Announces the whole body, sends half and closes.
        Truncate,
        /// Sends the body slowly, so a test can cancel half-way.
        Slow,
    }

    struct Server {
        url: String,
        requests: Arc<Mutex<Vec<Option<String>>>>,
    }

    /// A tiny HTTP/1.1 server on a loopback port that serves `body` (with `Range` support) to every connection.
    fn serve(body: Vec<u8>, mode: Mode) -> Server {
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
                    let _ = write!(out, "{head}Content-Length: {}\r\nConnection: close\r\n\r\n", slice.len());
                    let send = if mode == Mode::Truncate { &slice[..slice.len() / 2] } else { slice };
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

    fn body(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i * 31 % 251) as u8).collect()
    }

    fn sha(b: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(b);
        hex(h)
    }

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
        let r = tauri::async_runtime::block_on(download_file(&client, &s.url, 999, &sha(&data), &dest, &AtomicBool::new(false), &mut |_| {}));
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
    fn packs_know_their_size_when_they_are_installed_and_delete_cleanly() {
        let pack = find_pack("piper").unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(!list_packs(Some(dir.path())).iter().any(|p| p.installed));
        for f in pack.files {
            let p = dir.path().join(f.rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, vec![0u8; f.size as usize % 1000]).unwrap(); // wrong size: not installed
        }
        assert!(!pack.installed(dir.path()));
        for f in pack.files {
            let p = dir.path().join(f.rel);
            let file = File::create(&p).unwrap();
            file.set_len(f.size).unwrap();
        }
        assert!(pack.installed(dir.path()));
        assert_eq!(list_packs(Some(dir.path())).iter().filter(|p| p.installed).map(|p| p.id).collect::<Vec<_>>(), vec!["piper"]);
        assert_eq!(list_packs(None).iter().filter(|p| p.installed).count(), 0);
        fs::write(part_path(&dir.path().join(pack.files[0].rel)), b"x").unwrap();
        delete_pack(pack, dir.path()).unwrap();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        delete_pack(pack, dir.path()).unwrap(); // deleting twice is fine
        assert!(find_pack("nope").is_err());
    }

    #[test]
    fn the_catalog_is_well_formed_and_pinned() {
        let mut rels = std::collections::HashSet::new();
        for p in PACKS {
            assert!(!p.files.is_empty() && !p.voices.is_empty());
            for v in p.voices {
                assert!(crate::audio::VOICES.iter().any(|d| d.id == *v), "{v}");
            }
            for f in p.files {
                assert!(rels.insert(f.rel), "duplicate {}", f.rel);
                assert!(f.url.starts_with("https://") && !f.url.contains("/main/"), "{}", f.url);
                assert!(f.size > 0 && f.sha256.len() == 64 && f.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()), "{}", f.rel);
                assert!(Path::new(f.rel).components().all(|c| matches!(c, std::path::Component::Normal(_))) && !f.rel.contains('\\'), "{}", f.rel);
                if f.url.contains("huggingface.co") {
                    let commit = f.url.split("/resolve/").nth(1).and_then(|r| r.split('/').next()).unwrap();
                    assert!(commit.len() == 40 && commit.chars().all(|c| c.is_ascii_hexdigit()), "{}", f.url);
                }
            }
        }
        // every file a voice needs is in the pack that lists it
        for v in crate::audio::VOICES {
            let pack = PACKS.iter().find(|p| p.voices.contains(&v.id)).unwrap();
            assert!(v.files(Path::new("")).iter().all(|f| pack.files.iter().any(|r| Path::new(r.rel) == f.as_path())), "{}", v.id);
        }
        assert_eq!(find_pack("piper").unwrap().bytes(), 147_993_194);
        assert_eq!(find_pack("kokoro").unwrap().bytes(), 359_719_088);
    }

    /// Hits the real servers for the small files only (a few KB), to prove the pinned URLs, redirects, TLS and hashes
    /// work. Opt in with `CADABRA_NET_TESTS=1`; it never runs by default, so tests need no network.
    #[test]
    fn real_servers_serve_the_pinned_small_files() {
        if std::env::var("CADABRA_NET_TESTS").as_deref() != Ok("1") {
            eprintln!("skipping: set CADABRA_NET_TESTS=1 to download the small voice files");
            return;
        }
        let client = build_client().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let count = AtomicUsize::new(0);
        for f in PACKS.iter().flat_map(|p| p.files).filter(|f| f.size < 100_000) {
            let r = tauri::async_runtime::block_on(download_file(&client, f.url, f.size, f.sha256, &dir.path().join(f.rel), &AtomicBool::new(false), &mut |_| {}));
            assert_eq!(r, Ok(()), "{}", f.rel);
            count.fetch_add(1, Ordering::Relaxed);
        }
        assert_eq!(count.load(Ordering::Relaxed), 3);
    }

    /// Downloads every pack (about 510 MB) and renders a sentence with each voice through the real engine, which is
    /// the app's path end to end. Opt in with `CADABRA_NET_TESTS=full`, and `SHERPA_TTS_BIN` for the rendering.
    #[test]
    fn real_packs_download_and_then_speak() {
        if std::env::var("CADABRA_NET_TESTS").as_deref() != Ok("full") {
            eprintln!("skipping: set CADABRA_NET_TESTS=full to download the voice packs");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let (voices, book) = (dir.path().join("voices"), dir.path().join("book"));
        fs::create_dir_all(&book).unwrap();
        fs::write(book.join("cadabra.json"), "{}").unwrap();
        let client = build_client().unwrap();
        for pack in PACKS {
            let last = Mutex::new(0u64);
            let r = tauri::async_runtime::block_on(download_pack(&client, pack, &voices, &AtomicBool::new(false), &|p| *last.lock().unwrap() = p.done));
            assert_eq!(r, Ok(()), "{}", pack.id);
            assert_eq!(*last.lock().unwrap(), pack.bytes());
            assert!(pack.installed(&voices));
        }
        assert_eq!(crate::audio::list_voices(Some(&voices)).iter().filter(|v| v.installed).count(), crate::audio::VOICES.len());
        let Ok(bin) = crate::audio::find_sherpa() else {
            eprintln!("downloaded; skipping the render: no engine (SHERPA_TTS_BIN)");
            return;
        };
        for voice in crate::audio::VOICES {
            let req = crate::audio::ChapterRequest { job_id: "dl".into(), root: book.to_string_lossy().into_owned(), base: format!("exports/audio/{}", voice.id), chunks: vec![crate::audio::Chunk { text: "The quay was empty. A gull cried once.".into(), pause_after_ms: 600 }], voice: voice.id.into(), speed: 1.0, formats: vec!["opus".into(), "flac".into()] };
            let done = crate::audio::render_chapter(&req, &bin, Some(&voices), &AtomicBool::new(false), &|_| {}).unwrap();
            assert!(done.duration_sec > 1.0 && done.duration_sec < 30.0, "{}: {}", voice.id, done.duration_sec);
            assert!(book.join(format!("exports/audio/{}.opus", voice.id)).is_file());
        }
    }
}

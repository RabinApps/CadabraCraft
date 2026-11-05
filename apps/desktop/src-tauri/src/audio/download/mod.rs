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

/// The hash state and length of a partial download, read from disk.
fn rehash(path: &Path) -> Result<(Sha256, u64), AudioError> {
    let (mut hasher, mut have) = (Sha256::new(), 0u64);
    let mut f = File::open(path).map_err(io_err)?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(io_err)?;
        if n == 0 {
            return Ok((hasher, have));
        }
        hasher.update(&buf[..n]);
        have += n as u64;
    }
}

/// The longest one file may take in all, on top of the connect and per-read timeouts (which only catch a dead
/// connection, not one that trickles for days). A timed out download keeps its `.part` file for a later resume.
pub const DEADLINE: Duration = Duration::from_secs(30 * 60);

/// Downloads `url` to `dest`, resuming a `.part` file when the server honours `Range`, and renames it into place only
/// when its size and sha256 match. `progress` receives the bytes of this file present so far (including resumed ones).
/// Cancel leaves the `.part` file for a later resume; a hash mismatch deletes it.
pub async fn download_file(client: &reqwest::Client, url: &str, size: u64, sha256: &str, dest: &Path, cancel: &AtomicBool, progress: &mut (dyn FnMut(u64) + Send)) -> Result<(), AudioError> {
    download_file_within(client, url, size, sha256, dest, cancel, progress, DEADLINE).await
}

/// `download_file` with its overall time limit given (the tests use a short one).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn download_file_within(client: &reqwest::Client, url: &str, size: u64, sha256: &str, dest: &Path, cancel: &AtomicBool, progress: &mut (dyn FnMut(u64) + Send), deadline: Duration) -> Result<(), AudioError> {
    let started = Instant::now();
    if fs::metadata(dest).is_ok_and(|m| m.is_file() && m.len() == size) {
        // A file of the right size is only trusted when its hash matches too (it may be a corrupt or swapped file).
        let path = dest.to_path_buf();
        let (hasher, _) = tauri::async_runtime::spawn_blocking(move || rehash(&path)).await.map_err(other)??;
        if hex(hasher) == sha256 {
            progress(size);
            return Ok(());
        }
        fs::remove_file(dest).map_err(io_err)?; // never used; downloaded again below
    }
    let part = part_path(dest);
    fs::create_dir_all(dest.parent().unwrap_or(Path::new(""))).map_err(io_err)?; // "" (a bare file name) is a no-op
    let (mut hasher, mut have) = (Sha256::new(), 0u64);
    // A link or folder at the `.part` name is never followed or resumed: it is removed (the link, not its target).
    if let Ok(md) = fs::symlink_metadata(&part) {
        if md.is_file() && md.len() <= size {
            // Rehashing a partly downloaded voice (up to hundreds of MB) is disk-bound work: keep it off the async threads.
            let path = part.clone();
            (hasher, have) = tauri::async_runtime::spawn_blocking(move || rehash(&path)).await.map_err(other)??;
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
        let mut out = if append {
            OpenOptions::new().append(true).open(&part).map_err(io_err)? // the resumed file, checked above
        } else {
            // A fresh start never reuses a file that is already there: remove it, then create it exclusively.
            let _ = fs::remove_file(&part);
            OpenOptions::new().write(true).create_new(true).open(&part).map_err(io_err)?
        };
        let mut last = Instant::now();
        progress(have);
        while let Some(chunk) = resp.chunk().await.map_err(net_err)? {
            if cancel.load(Ordering::Relaxed) {
                return Err(AudioError::Cancelled);
            }
            if started.elapsed() > deadline {
                return Err(AudioError::Download { message: format!("the download took longer than the {} second limit", deadline.as_secs()) });
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
        // fsync can take a while on a slow disk; it must not hold an async thread.
        tauri::async_runtime::spawn_blocking(move || out.flush().and_then(|()| out.sync_all())).await.map_err(other)?.map_err(io_err)?;
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
mod tests;

//! The `cadabra-ref` URI scheme: streams audio and video references to `<video>` and `<audio>` with HTTP range
//! semantics, so a 500 MB video never has to be assembled in the webview. It serves only flat audio and video files of
//! `references/` in a project the webview has asked for through `reference_stream_url` (same path rules as every other
//! reference read, see `project/media.rs`). The URL holds an opaque token, never a folder path.
use crate::platform::blocking;
use crate::project::{self, MediaRead, ProjectError};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::State;

/// The scheme name. The webview reaches it as `cadabra-ref://localhost/...` (`http://cadabra-ref.localhost/...` on
/// Windows and Android, where WebView2 has no custom schemes of its own); both are in `media-src` in `tauri.conf.json`.
pub const MEDIA_SCHEME: &str = "cadabra-ref";

const NAME_SET: &AsciiSet = &NON_ALPHANUMERIC.remove(b'.').remove(b'-').remove(b'_');

/// Projects the webview may stream from: opaque token to project folder. A token is a hash of the folder, so the same
/// project always gets the same URLs (the viewer caches them) and a page cannot name a folder it was not given.
#[derive(Clone, Default)]
pub struct MediaRoots(Arc<Mutex<HashMap<String, PathBuf>>>);

/// Most projects remembered at once. An author has one or two open; this only bounds what a webview that keeps asking
/// for URLs of different folders could make the app remember.
const MAX_ROOTS: usize = 64;

impl MediaRoots {
    fn register(&self, root: &Path) -> String {
        let hash = Sha256::digest(root.to_string_lossy().as_bytes());
        let token: String = hash.iter().take(16).map(|b| format!("{b:02x}")).collect();
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !map.contains_key(&token) && map.len() >= MAX_ROOTS {
            // Which entry goes is arbitrary: a project that loses its token gets a new one on its next `reference_stream_url`.
            if let Some(evict) = map.keys().next().cloned() {
                map.remove(&evict);
            }
        }
        map.insert(token.clone(), root.to_path_buf());
        token
    }

    fn root_of(&self, token: &str) -> Option<PathBuf> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).get(token).cloned()
    }
}

/// `<origin>/<token>/<name>` for a reference file name (what follows `references/`).
fn url_for(windows_style: bool, token: &str, name: &str) -> String {
    let origin = if windows_style { format!("http://{MEDIA_SCHEME}.localhost") } else { format!("{MEDIA_SCHEME}://localhost") };
    format!("{origin}/{token}/{}", utf8_percent_encode(name, NAME_SET))
}

/// The token and `references/<name>` a request path names, or None for any other shape (more or fewer parts, bad UTF-8).
fn parse_path(path: &str) -> Option<(String, String)> {
    let (token, name) = path.strip_prefix('/')?.split_once('/')?;
    let name = percent_decode_str(name).decode_utf8().ok()?;
    Some((token.to_string(), format!("references/{name}")))
}

/// Allows streaming `references/<path>` of the project at `root`; resolves to the URL the player should load.
#[tauri::command]
pub async fn reference_stream_url(roots: State<'_, MediaRoots>, root: String, path: String) -> Result<String, ProjectError> {
    let (root, name) = blocking(move || {
        let root = project::require_project(&PathBuf::from(root))?;
        project::media_path(&root, &path)?;
        Ok::<_, ProjectError>((root, path))
    })
    .await?;
    let token = roots.register(&root);
    Ok(url_for(cfg!(any(windows, target_os = "android")), &token, name.strip_prefix("references/").unwrap_or(&name)))
}

fn reply(status: StatusCode, headers: &[(header::HeaderName, String)], body: Vec<u8>) -> Response<Vec<u8>> {
    let mut res = Response::builder().status(status).header(header::ACCEPT_RANGES, "bytes").header(header::CACHE_CONTROL, "no-store");
    for (name, value) in headers {
        res = res.header(name, value);
    }
    // Only an invalid header value can fail the builder; every header here is ours, so fall back to an empty 500 rather than panic.
    res.body(body).unwrap_or_else(|_| {
        let mut fallback = Response::new(Vec::new());
        *fallback.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
        fallback
    })
}

fn error_status(e: &ProjectError) -> StatusCode {
    match e {
        ProjectError::NotFound { .. } => StatusCode::NOT_FOUND,
        _ => StatusCode::FORBIDDEN,
    }
}

/// Answers one request: 200 or 206 with the bytes, 416 past the end of the file, 404 for a file or token that is not
/// there, 403 for anything that may not be streamed, 400 for a URL of the wrong shape, 405 for a method other than GET.
pub fn respond(roots: &MediaRoots, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let nothing = |status| reply(status, &[], vec![]);
    if req.method() != Method::GET {
        return nothing(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some((token, rel)) = parse_path(req.uri().path()) else { return nothing(StatusCode::BAD_REQUEST) };
    let Some(root) = roots.root_of(&token) else { return nothing(StatusCode::NOT_FOUND) };
    let range = req.headers().get(header::RANGE).and_then(|v| v.to_str().ok());
    match project::read_media(&root, &rel, range) {
        Err(e) => nothing(error_status(&e)),
        Ok(MediaRead::OutOfRange { total }) => reply(StatusCode::RANGE_NOT_SATISFIABLE, &[(header::CONTENT_RANGE, format!("bytes */{total}"))], vec![]),
        Ok(MediaRead::Slice { bytes, start, total, partial, content_type }) => {
            let mut headers = vec![(header::CONTENT_TYPE, content_type.to_string()), (header::CONTENT_LENGTH, bytes.len().to_string())];
            if !partial {
                return reply(StatusCode::OK, &headers, bytes);
            }
            headers.push((header::CONTENT_RANGE, format!("bytes {start}-{}/{total}", start + bytes.len() as u64 - 1)));
            reply(StatusCode::PARTIAL_CONTENT, &headers, bytes)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn get(roots: &MediaRoots, path: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let mut b = Request::builder().method(Method::GET).uri(format!("{MEDIA_SCHEME}://localhost{path}"));
        if let Some(r) = range {
            b = b.header(header::RANGE, r);
        }
        respond(roots, &b.body(vec![]).unwrap())
    }

    fn h(res: &Response<Vec<u8>>, name: header::HeaderName) -> String {
        res.headers().get(name).map(|v| v.to_str().unwrap().to_string()).unwrap_or_default()
    }

    /// A project with `references/clip.mp4` (10 bytes) and a registered token for it.
    fn setup() -> (tempfile::TempDir, MediaRoots, String) {
        let book = super::super::testutil::project();
        fs::create_dir(book.path().join("references")).unwrap();
        fs::write(book.path().join("references/clip.mp4"), b"0123456789").unwrap();
        fs::write(book.path().join("references/pic.png"), b"x").unwrap();
        let roots = MediaRoots::default();
        let token = roots.register(book.path());
        (book, roots, token)
    }

    #[test]
    fn urls_use_the_platform_origin_and_encode_the_name() {
        assert_eq!(url_for(false, "ab", "a b#.mp4"), "cadabra-ref://localhost/ab/a%20b%23.mp4");
        assert_eq!(url_for(true, "ab", "x_y-1.webm"), "http://cadabra-ref.localhost/ab/x_y-1.webm");
        assert_eq!(parse_path("/ab/a%20b%23.mp4"), Some(("ab".into(), "references/a b#.mp4".into())));
        for bad in ["", "/", "/ab", "ab/c.mp4", "/ab/%ff.mp4"] {
            assert_eq!(parse_path(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_token_is_stable_per_project_and_opaque() {
        let (book, roots, token) = setup();
        assert_eq!(roots.register(book.path()), token);
        assert_eq!(token.len(), 32);
        assert!(!token.contains(&*book.path().to_string_lossy()));
        assert_eq!(roots.root_of(&token), Some(book.path().to_path_buf()));
        assert_eq!(roots.root_of("nope"), None);
    }

    #[test]
    fn the_token_table_is_bounded_and_survives_a_poisoned_lock() {
        let roots = MediaRoots::default();
        let (keep, _) = (roots.register(Path::new("/book/0")), ());
        for i in 1..MAX_ROOTS + 20 {
            roots.register(Path::new(&format!("/book/{i}")));
        }
        assert_eq!(roots.0.lock().unwrap().len(), MAX_ROOTS);
        assert_eq!(roots.register(Path::new("/book/0")), keep, "a token is a hash of the folder, however often it is evicted");
        assert_eq!(roots.root_of(&keep), Some(PathBuf::from("/book/0")));
        let held = roots.clone();
        assert!(std::thread::spawn(move || {
            let _guard = held.0.lock().unwrap();
            panic!("poison the lock");
        })
        .join()
        .is_err());
        assert_eq!(roots.root_of(&keep), Some(PathBuf::from("/book/0")));
        assert!(!roots.register(Path::new("/book/last")).is_empty());
    }

    #[test]
    fn a_plain_request_gets_the_file_and_a_range_request_gets_206() {
        let (_book, roots, t) = setup();
        let whole = get(&roots, &format!("/{t}/clip.mp4"), None);
        assert_eq!((whole.status(), whole.body().as_slice()), (StatusCode::OK, &b"0123456789"[..]));
        assert_eq!((h(&whole, header::CONTENT_TYPE), h(&whole, header::CONTENT_LENGTH), h(&whole, header::ACCEPT_RANGES)), ("video/mp4".into(), "10".into(), "bytes".into()));
        let part = get(&roots, &format!("/{t}/clip.mp4"), Some("bytes=2-4"));
        assert_eq!((part.status(), part.body().as_slice()), (StatusCode::PARTIAL_CONTENT, &b"234"[..]));
        assert_eq!((h(&part, header::CONTENT_RANGE), h(&part, header::CONTENT_LENGTH)), ("bytes 2-4/10".into(), "3".into()));
        let tail = get(&roots, &format!("/{t}/clip.mp4"), Some("bytes=-2"));
        assert_eq!((h(&tail, header::CONTENT_RANGE), tail.body().as_slice()), ("bytes 8-9/10".into(), &b"89"[..]));
    }

    #[test]
    fn a_range_past_the_end_is_416_with_the_size() {
        let (_book, roots, t) = setup();
        let res = get(&roots, &format!("/{t}/clip.mp4"), Some("bytes=10-"));
        assert_eq!((res.status(), h(&res, header::CONTENT_RANGE), res.body().len()), (StatusCode::RANGE_NOT_SATISFIABLE, "bytes */10".into(), 0));
    }

    #[test]
    fn everything_else_is_refused_with_a_status() {
        let (book, roots, t) = setup();
        let status = |path: String| get(&roots, &path, None).status();
        assert_eq!(status(format!("/{t}/pic.png")), StatusCode::FORBIDDEN); // not audio or video
        assert_eq!(status(format!("/{t}/..%2Fcadabra.json")), StatusCode::FORBIDDEN);
        assert_eq!(status(format!("/{t}/sub%2Fclip.mp4")), StatusCode::FORBIDDEN);
        assert_eq!(status(format!("/{t}/gone.mp4")), StatusCode::NOT_FOUND);
        assert_eq!(status("/unknown-token/clip.mp4".into()), StatusCode::NOT_FOUND);
        assert_eq!(status("/".into()), StatusCode::BAD_REQUEST);
        assert_eq!(status(format!("/{t}/%ff.mp4")), StatusCode::BAD_REQUEST);
        let post = Request::builder().method(Method::POST).uri(format!("{MEDIA_SCHEME}://localhost/{t}/clip.mp4")).body(vec![]).unwrap();
        assert_eq!(respond(&roots, &post).status(), StatusCode::METHOD_NOT_ALLOWED);
        // A range header that is not text is ignored, like any other bad one.
        let weird = Request::builder().uri(format!("{MEDIA_SCHEME}://localhost/{t}/clip.mp4")).header(header::RANGE, &[0xff_u8][..]).body(vec![]).unwrap();
        assert_eq!(respond(&roots, &weird).status(), StatusCode::OK);
        // A folder that stopped being a project is still only reachable through its own references/ folder.
        fs::remove_file(book.path().join("references/clip.mp4")).unwrap();
        assert_eq!(status(format!("/{t}/clip.mp4")), StatusCode::NOT_FOUND);
    }
}

#[cfg(test)]
mod review_repro;

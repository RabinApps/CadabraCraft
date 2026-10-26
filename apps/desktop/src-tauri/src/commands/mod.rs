//! Tauri command handlers. Every file command runs on the blocking thread pool (`typst::blocking`) so disk IO, hashing
//! and large reads never stall the UI. Errors are `ProjectError` (`{ kind, ...params }`, see `project/error.rs`).
use crate::project::{self, FileRead, ProjectError, TrashEntry, WriteResult};
use crate::typst::blocking;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};

#[tauri::command]
pub async fn create_project(root: String, manifest_json: String) -> Result<(), ProjectError> {
    blocking(move || project::create_project(&project::require_absolute(&PathBuf::from(root))?, &manifest_json)).await
}

#[tauri::command]
pub async fn read_project_file(root: String, path: String) -> Result<Option<FileRead>, ProjectError> {
    blocking(move || {
        let root = PathBuf::from(root);
        // Opening a folder reads its manifest; a folder without one is "not a project yet", not an error.
        let root = if path == project::MANIFEST { project::require_absolute(&root)? } else { project::require_project(&root)? };
        project::read_file(&root, &path)
    })
    .await
}

#[tauri::command]
pub async fn write_project_file(root: String, path: String, contents: String, base_hash: Option<String>) -> Result<WriteResult, ProjectError> {
    blocking(move || project::write_file(&project::require_project(&PathBuf::from(root))?, &path, &contents, base_hash.as_deref())).await
}

#[tauri::command]
pub async fn backup_manifest(root: String) -> Result<String, ProjectError> {
    blocking(move || project::backup_manifest(&project::require_project(&PathBuf::from(root))?)).await
}

#[tauri::command]
pub async fn trash_project_file(root: String, path: String) -> Result<String, ProjectError> {
    blocking(move || project::trash_file(&project::require_project(&PathBuf::from(root))?, &path)).await
}

/// Pages in the project trash that can be restored, newest first.
#[tauri::command]
pub async fn list_project_trash(root: String) -> Result<Vec<TrashEntry>, ProjectError> {
    blocking(move || project::list_trash(&project::require_project(&PathBuf::from(root))?)).await
}

/// Moves a trashed page back into the project (never overwriting) and returns its new relative path.
#[tauri::command]
pub async fn restore_project_trash(root: String, path: String) -> Result<String, ProjectError> {
    blocking(move || project::restore_trash(&project::require_project(&PathBuf::from(root))?, &path)).await
}

/// Decodes `%XX` escapes (UTF-8). Header values are ASCII, so the caller sends paths with `encodeURIComponent`.
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Pulls `(root, path, bytes)` out of a `write_project_bytes` call. Preferred form: the invoke payload is the raw file
/// bytes and `root` / `path` travel in `encodeURIComponent`-encoded headers (no JSON number array). The old form
/// (JSON body `{ root, path, bytes: number[] }`) is still accepted.
fn parse_write_bytes(body: &InvokeBody, headers: &tauri::http::HeaderMap) -> Result<(String, String, Vec<u8>), ProjectError> {
    let bad = |what: &str| ProjectError::Io { message: format!("write_project_bytes: {what}") };
    match body {
        InvokeBody::Raw(bytes) => {
            let header = |name: &str| {
                let v = headers.get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| bad(&format!("missing {name} header")))?;
                percent_decode(v).ok_or_else(|| bad(&format!("bad {name} header")))
            };
            Ok((header("root")?, header("path")?, bytes.clone()))
        }
        InvokeBody::Json(v) => {
            #[derive(serde::Deserialize)]
            struct Legacy {
                root: String,
                path: String,
                bytes: Vec<u8>,
            }
            let l: Legacy = serde_json::from_value(v.clone()).map_err(|e| bad(&e.to_string()))?;
            Ok((l.root, l.path, l.bytes))
        }
    }
}

#[tauri::command]
pub async fn write_project_bytes(request: Request<'_>) -> Result<(), ProjectError> {
    let (root, path, bytes) = parse_write_bytes(request.body(), request.headers())?;
    blocking(move || project::write_bytes(&project::require_project(&PathBuf::from(root))?, &path, &bytes)).await
}

#[tauri::command]
pub fn watch_project(app: tauri::AppHandle, state: tauri::State<crate::fs_watch::WatchState>, root: String) -> Result<(), String> {
    let root = project::require_project(&PathBuf::from(root)).map_err(|e| e.to_string())?;
    crate::fs_watch::start(app, root, &state)
}

/// Copies an image the user picked into `assets/`; returns `assets/<name>`.
#[tauri::command]
pub async fn import_asset(root: String, source: String) -> Result<String, ProjectError> {
    blocking(move || project::import_image(&project::require_project(&PathBuf::from(root))?, &PathBuf::from(source))).await
}

/// Bytes of a document the user picked for import (.docx/.md/.markdown/.txt, at most 200 MB). Read-only.
#[tauri::command]
pub async fn read_import_source(path: String) -> Result<Response, ProjectError> {
    blocking(move || crate::import_src::read_source(&PathBuf::from(path))).await.map(Response::new)
}

/// Bytes of an image a Markdown file references, resolved inside that file's folder. Read-only.
#[tauri::command]
pub async fn read_import_image(source_file: String, reference: String) -> Result<Response, ProjectError> {
    blocking(move || crate::import_src::read_relative_image(&PathBuf::from(source_file), &reference)).await.map(Response::new)
}

/// Stores image bytes (from an imported document) in `assets/`; returns the actual `assets/<name>` used.
#[tauri::command]
pub async fn import_asset_bytes(root: String, name: String, bytes: Vec<u8>) -> Result<String, ProjectError> {
    blocking(move || project::store_image(&project::require_project(&PathBuf::from(root))?, &name, &bytes)).await
}

/// Raw bytes of `assets/<image>` for display (sent as binary, not a JSON array).
#[tauri::command]
pub async fn read_asset(root: String, path: String) -> Result<Response, ProjectError> {
    blocking(move || project::read_asset(&project::require_project(&PathBuf::from(root))?, &path)).await.map(Response::new)
}

/// Whether this build can update itself. Linux packages other than an AppImage (a `.deb`) cannot be replaced by the
/// updater, so they are not offered an update.
pub fn self_update_supported(is_linux: bool, appimage: bool) -> bool {
    !is_linux || appimage
}

/// Asked once at startup and before a manual check, so the webview never offers an update it cannot install.
#[tauri::command]
pub fn updates_supported() -> bool {
    self_update_supported(cfg!(target_os = "linux"), std::env::var_os("APPIMAGE").is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::{HeaderMap, HeaderValue};

    fn headers(root: &str, path: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("root", HeaderValue::from_str(root).unwrap());
        h.insert("path", HeaderValue::from_str(path).unwrap());
        h
    }

    #[test]
    fn percent_decode_handles_utf8_and_rejects_bad_escapes() {
        assert_eq!(percent_decode("a%20b%2Fc").as_deref(), Some("a b/c"));
        assert_eq!(percent_decode("%E2%9C%93").as_deref(), Some("\u{2713}"));
        assert_eq!(percent_decode("plain").as_deref(), Some("plain"));
        for bad in ["%", "%2", "%zz", "%FF"] {
            assert_eq!(percent_decode(bad), None, "{bad}");
        }
    }

    #[test]
    fn raw_body_takes_root_and_path_from_headers() {
        let body = InvokeBody::Raw(vec![1, 2, 3]);
        let (r, p, b) = parse_write_bytes(&body, &headers("%2FUsers%2Fa%20b%2FBook", "exports%2Fbook.epub")).unwrap();
        assert_eq!((r.as_str(), p.as_str(), b), ("/Users/a b/Book", "exports/book.epub", vec![1, 2, 3]));
    }

    #[test]
    fn raw_body_without_headers_is_an_error() {
        let err = parse_write_bytes(&InvokeBody::Raw(vec![1]), &HeaderMap::new()).unwrap_err();
        assert!(matches!(err, ProjectError::Io { .. }), "{err:?}");
    }

    #[test]
    fn legacy_json_body_still_works() {
        let body = InvokeBody::Json(serde_json::json!({ "root": "/r", "path": "exports/a.pdf", "bytes": [7, 8] }));
        assert_eq!(parse_write_bytes(&body, &HeaderMap::new()).unwrap(), ("/r".into(), "exports/a.pdf".into(), vec![7, 8]));
        assert!(parse_write_bytes(&InvokeBody::Json(serde_json::json!({ "root": 1 })), &HeaderMap::new()).is_err());
    }

    #[test]
    fn self_update_is_offered_everywhere_but_a_linux_package_without_appimage() {
        assert!(self_update_supported(false, false));
        assert!(self_update_supported(true, true));
        assert!(!self_update_supported(true, false));
    }
}

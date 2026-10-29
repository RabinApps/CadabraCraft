//! Project file commands: create, read, write, back up and trash pages, and the folder watcher.
use super::wire::parse_write_bytes;
use crate::platform::blocking;
use crate::project::{self, FileRead, ProjectError, TrashEntry, WriteResult};
use std::path::PathBuf;
use tauri::http::HeaderMap;
use tauri::ipc::{InvokeBody, Request};

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

/// The body of `write_project_bytes`, taking the parts of the request so it can run without a webview.
async fn write_bytes_request(body: &InvokeBody, headers: &HeaderMap) -> Result<(), ProjectError> {
    let (root, path, bytes) = parse_write_bytes(body, headers)?;
    blocking(move || project::write_bytes(&project::require_project(&PathBuf::from(root))?, &path, &bytes)).await
}

#[tauri::command]
pub async fn write_project_bytes(request: Request<'_>) -> Result<(), ProjectError> {
    write_bytes_request(request.body(), request.headers()).await
}

/// The folder to watch: it must be a project.
fn watch_root(root: String) -> Result<PathBuf, ProjectError> {
    project::require_project(&PathBuf::from(root))
}

#[tauri::command]
pub fn watch_project<R: tauri::Runtime>(app: tauri::AppHandle<R>, state: tauri::State<crate::platform::fs_watch::WatchState>, root: String) -> Result<(), ProjectError> {
    crate::platform::fs_watch::start(app, watch_root(root)?, &state)
}

#[tauri::command]
pub fn unwatch_project(state: tauri::State<crate::platform::fs_watch::WatchState>) -> Result<(), ProjectError> {
    crate::platform::fs_watch::stop(&state)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{project, root, run};
    use super::*;
    use tauri::http::HeaderValue;

    #[test]
    fn a_project_is_created_and_its_manifest_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path().join("Book").to_string_lossy().into_owned();
        assert_eq!(run(read_project_file(r.clone(), "cadabra.json".into())).unwrap(), None);
        run(create_project(r.clone(), "{\"a\":1}".into())).unwrap();
        assert_eq!(run(read_project_file(r.clone(), "cadabra.json".into())).unwrap().unwrap().contents, "{\"a\":1}");
        assert_eq!(run(create_project(r.clone(), "{}".into())), Err(ProjectError::AlreadyExists));
        assert!(run(create_project("relative".into(), "{}".into())).is_err());
        let backup = run(backup_manifest(r)).unwrap();
        assert!(backup.starts_with(".cadabra/backups/"), "{backup}");
    }

    #[test]
    fn pages_are_written_read_trashed_and_restored() {
        let book = project();
        let page = "manuscript/001-a.json";
        assert_eq!(run(read_project_file(root(&book), page.into())).unwrap(), None);
        let w = run(write_project_file(root(&book), page.into(), "text".into(), None)).unwrap();
        let read = run(read_project_file(root(&book), page.into())).unwrap().unwrap();
        assert_eq!((read.contents.as_str(), read.hash.as_str()), ("text", w.hash.as_str()));
        assert!(run(write_project_file(root(&book), page.into(), "x".into(), Some("stale".into()))).unwrap().conflict_copy.is_some());
        assert!(run(list_project_trash(root(&book))).unwrap().is_empty());
        let trashed = run(trash_project_file(root(&book), page.into())).unwrap();
        let listed = run(list_project_trash(root(&book))).unwrap();
        assert_eq!(listed.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), vec![trashed.as_str()]);
        assert_eq!(run(restore_project_trash(root(&book), trashed)).unwrap(), page);
        assert!(run(trash_project_file(root(&book), "manuscript/missing.json".into())).is_err());
    }

    #[test]
    fn file_commands_other_than_the_manifest_read_need_a_project() {
        let plain = tempfile::tempdir().unwrap();
        let r = plain.path().to_string_lossy().into_owned();
        assert!(run(read_project_file(r.clone(), "manuscript/001-a.json".into())).is_err());
        assert!(run(write_project_file(r.clone(), "manuscript/001-a.json".into(), "x".into(), None)).is_err());
        assert!(run(backup_manifest(r.clone())).is_err());
        assert!(run(list_project_trash(r)).is_err());
    }

    fn headers(root: &str, path: &str) -> HeaderMap {
        let enc = |s: &str| s.replace('/', "%2F");
        let mut h = HeaderMap::new();
        h.insert("root", HeaderValue::from_str(&enc(root)).unwrap());
        h.insert("path", HeaderValue::from_str(&enc(path)).unwrap());
        h
    }

    #[test]
    fn raw_and_legacy_byte_writes_land_under_exports() {
        let book = project();
        let r = root(&book);
        run(write_bytes_request(&InvokeBody::Raw(vec![1, 2, 3]), &headers(&r, "exports/a.bin"))).unwrap();
        assert_eq!(std::fs::read(book.path().join("exports/a.bin")).unwrap(), vec![1, 2, 3]);
        let legacy = InvokeBody::Json(serde_json::json!({ "root": r, "path": "exports/b.bin", "bytes": [9] }));
        run(write_bytes_request(&legacy, &HeaderMap::new())).unwrap();
        assert_eq!(std::fs::read(book.path().join("exports/b.bin")).unwrap(), vec![9]);
        assert!(run(write_bytes_request(&InvokeBody::Raw(vec![]), &HeaderMap::new())).is_err());
        assert!(run(write_bytes_request(&InvokeBody::Raw(vec![1]), &headers(&r, "manuscript/a.json"))).is_err());
    }

    #[test]
    fn only_a_project_can_be_watched() {
        let book = project();
        assert_eq!(watch_root(root(&book)).unwrap(), book.path());
        assert!(matches!(watch_root(root(&tempfile::tempdir().unwrap())), Err(ProjectError::NotAProject { .. })));
    }
}

use crate::project::{self, FileRead, WriteResult};
use std::path::PathBuf;

#[tauri::command]
pub fn create_project(root: String, manifest_json: String) -> Result<(), String> {
    project::create_project(&PathBuf::from(root), &manifest_json)
}

#[tauri::command]
pub fn read_project_file(root: String, path: String) -> Result<Option<FileRead>, String> {
    project::read_file(&PathBuf::from(root), &path)
}

#[tauri::command]
pub fn write_project_file(root: String, path: String, contents: String, base_hash: Option<String>) -> Result<WriteResult, String> {
    project::write_file(&PathBuf::from(root), &path, &contents, base_hash.as_deref())
}

#[tauri::command]
pub fn backup_manifest(root: String) -> Result<String, String> {
    project::backup_manifest(&PathBuf::from(root))
}

#[tauri::command]
pub fn trash_project_file(root: String, path: String) -> Result<String, String> {
    project::trash_file(&PathBuf::from(root), &path)
}

#[tauri::command]
pub fn write_project_bytes(root: String, path: String, bytes: Vec<u8>) -> Result<(), String> {
    project::write_bytes(&PathBuf::from(root), &path, &bytes)
}

#[tauri::command]
pub fn watch_project(app: tauri::AppHandle, state: tauri::State<crate::fs_watch::WatchState>, root: String) -> Result<(), String> {
    crate::fs_watch::start(app, PathBuf::from(root), &state)
}

/// Copies an image the user picked into `assets/`; returns `assets/<name>`.
#[tauri::command]
pub fn import_asset(root: String, source: String) -> Result<String, String> {
    project::import_image(&PathBuf::from(root), &PathBuf::from(source))
}

/// Bytes of a document the user picked for import (.docx/.md/.markdown/.txt, at most 200 MB). Read-only.
#[tauri::command]
pub fn read_import_source(path: String) -> Result<tauri::ipc::Response, String> {
    crate::import_src::read_source(&PathBuf::from(path)).map(tauri::ipc::Response::new)
}

/// Bytes of an image a Markdown file references, resolved inside that file's folder. Read-only.
#[tauri::command]
pub fn read_import_image(source_file: String, reference: String) -> Result<tauri::ipc::Response, String> {
    crate::import_src::read_relative_image(&PathBuf::from(source_file), &reference).map(tauri::ipc::Response::new)
}

/// Stores image bytes (from an imported document) in `assets/`; returns the actual `assets/<name>` used.
#[tauri::command]
pub fn import_asset_bytes(root: String, name: String, bytes: Vec<u8>) -> Result<String, String> {
    project::store_image(&PathBuf::from(root), &name, &bytes)
}

/// Raw bytes of `assets/<image>` for display (sent as binary, not a JSON array).
#[tauri::command]
pub fn read_asset(root: String, path: String) -> Result<tauri::ipc::Response, String> {
    project::read_asset(&PathBuf::from(root), &path).map(tauri::ipc::Response::new)
}

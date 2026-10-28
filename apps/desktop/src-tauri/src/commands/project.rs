//! Project file commands: create, read, write, back up and trash pages, and the folder watcher.
use super::wire::parse_write_bytes;
use crate::platform::blocking;
use crate::project::{self, FileRead, ProjectError, TrashEntry, WriteResult};
use std::path::PathBuf;
use tauri::ipc::Request;

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

#[tauri::command]
pub async fn write_project_bytes(request: Request<'_>) -> Result<(), ProjectError> {
    let (root, path, bytes) = parse_write_bytes(request.body(), request.headers())?;
    blocking(move || project::write_bytes(&project::require_project(&PathBuf::from(root))?, &path, &bytes)).await
}

#[tauri::command]
pub fn watch_project(app: tauri::AppHandle, state: tauri::State<crate::platform::fs_watch::WatchState>, root: String) -> Result<(), String> {
    let root = project::require_project(&PathBuf::from(root)).map_err(|e| e.to_string())?;
    crate::platform::fs_watch::start(app, root, &state)
}

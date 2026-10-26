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

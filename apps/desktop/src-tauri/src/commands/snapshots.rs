//! Page snapshot commands (see `project/snapshots.rs`).
use crate::platform::blocking;
use crate::project::snapshots::{self, SnapshotEntry, StalePage};
use crate::project::{self, FileRead, ProjectError, WriteResult};
use std::path::PathBuf;

/// Earlier versions of a page, newest first (see `project/snapshots.rs`).
#[tauri::command]
pub async fn list_page_snapshots(root: String, path: String) -> Result<Vec<SnapshotEntry>, ProjectError> {
    blocking(move || snapshots::list_snapshots(&project::require_project(&PathBuf::from(root))?, &path)).await
}

#[tauri::command]
pub async fn read_page_snapshot(root: String, path: String, snapshot: String) -> Result<FileRead, ProjectError> {
    blocking(move || snapshots::read_snapshot(&project::require_project(&PathBuf::from(root))?, &path, &snapshot)).await
}

/// Puts a snapshot back as the page; the text it replaces is kept as a snapshot first.
#[tauri::command]
pub async fn restore_page_snapshot(root: String, path: String, snapshot: String) -> Result<WriteResult, ProjectError> {
    blocking(move || snapshots::restore_snapshot(&project::require_project(&PathBuf::from(root))?, &path, &snapshot)).await
}

/// Removes old snapshots beyond `keep` per page (never ones younger than 30 days). Returns how many were removed.
#[tauri::command]
pub async fn prune_page_snapshots(root: String, paths: Vec<String>, keep: usize) -> Result<u32, ProjectError> {
    blocking(move || snapshots::prune(&project::require_project(&PathBuf::from(root))?, &paths, keep, chrono::Utc::now())).await
}

/// Pages whose newest snapshot is newer than the page and differs from it.
#[tauri::command]
pub async fn find_stale_pages(root: String, paths: Vec<String>) -> Result<Vec<StalePage>, ProjectError> {
    blocking(move || snapshots::find_stale(&project::require_project(&PathBuf::from(root))?, &paths)).await
}

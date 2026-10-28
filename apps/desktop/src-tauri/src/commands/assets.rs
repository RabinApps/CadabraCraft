//! Image asset commands.
use crate::platform::blocking;
use crate::project::{self, ProjectError};
use std::path::PathBuf;
use tauri::ipc::Response;

/// Copies an image the user picked into `assets/`; returns `assets/<name>`.
#[tauri::command]
pub async fn import_asset(root: String, source: String) -> Result<String, ProjectError> {
    blocking(move || project::import_image(&project::require_project(&PathBuf::from(root))?, &PathBuf::from(source))).await
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

//! Commands that read a document the user picked for import. Read-only.
use crate::platform::blocking;
use crate::project::ProjectError;
use std::path::PathBuf;
use tauri::ipc::Response;

/// Bytes of a document the user picked for import (.docx/.md/.markdown/.html/.htm/.txt, at most 200 MB). Read-only.
#[tauri::command]
pub async fn read_import_source(path: String) -> Result<Response, ProjectError> {
    blocking(move || crate::import_src::read_source(&PathBuf::from(path))).await.map(Response::new)
}

/// Bytes of an image a Markdown file references, resolved inside that file's folder. Read-only.
#[tauri::command]
pub async fn read_import_image(source_file: String, reference: String) -> Result<Response, ProjectError> {
    blocking(move || crate::import_src::read_relative_image(&PathBuf::from(source_file), &reference)).await.map(Response::new)
}

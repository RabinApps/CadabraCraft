//! The Tauri command layer for the PDF export (blocking work runs off the UI thread).
use super::engine::{compile, find_typst, list_fonts, version, COMPILE_TIMEOUT};
use super::error::{other, TypstError};
use super::request::parse_compile_request;
use crate::platform::blocking;
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct TypstInfo {
    pub path: String,
    pub version: String,
}

/// Locates typst and reports its version; `NotFound` carries install advice.
#[tauri::command]
pub async fn typst_find(typst_path: Option<String>) -> Result<TypstInfo, TypstError> {
    blocking(move || {
        let bin = find_typst(typst_path.as_deref())?;
        let version = version(&bin)?;
        Ok(TypstInfo { path: bin.to_string_lossy().into_owned(), version })
    })
    .await
}

#[tauri::command]
pub async fn typst_list_fonts(typst_path: Option<String>) -> Result<Vec<String>, TypstError> {
    blocking(move || list_fonts(&find_typst(typst_path.as_deref())?)).await
}

/// The request is one binary body (see `parse_compile_request`): options, source and (relative name, bytes) image files
/// written next to the source. Returns the PDF as raw bytes.
#[tauri::command]
pub async fn typst_compile(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, TypstError> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(other("typst_compile expects a binary body"));
    };
    let req = parse_compile_request(body)?;
    blocking(move || {
        let bin = find_typst(req.typst_path.as_deref())?;
        compile(&bin, &std::env::temp_dir(), &req.source, &req.files, req.pdf_a, COMPILE_TIMEOUT)
    })
    .await
    .map(tauri::ipc::Response::new)
}

//! The Tauri command layer for fonts. File work runs on Tauri's blocking pool; downloads are `async` on the runtime
//! (like the voice downloads) and share the audio job flags, so `fonts_cancel` is `audio_cancel` under another name.
use super::catalog::{find_family, list_catalog, Family, FontPackInfo};
use super::error::{invalid, other, FontError};
use super::fonts_root;
use super::import::import_font;
use super::store::{delete_font, list_installed, read_font_file, InstalledFont};
use crate::audio::download::{build_client, download_file, DownloadProgress};
use crate::audio::jobs::AudioJobs;
use crate::commands::{PickKind, PickedPaths};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

fn require_root(root: Option<PathBuf>) -> Result<PathBuf, FontError> {
    root.ok_or_else(|| other("there is no folder for fonts on this computer"))
}

#[tauri::command]
pub async fn fonts_catalog() -> Result<Vec<FontPackInfo>, FontError> {
    crate::platform::blocking(|| Ok(list_catalog(fonts_root().as_deref()))).await
}

#[tauri::command]
pub async fn fonts_installed() -> Result<Vec<InstalledFont>, FontError> {
    crate::platform::blocking(|| Ok(list_installed(fonts_root().as_deref()))).await
}

/// Downloads every file of the family (and its licence text) that is not there yet, one after another. `on_progress`
/// gets the bytes of the whole family.
async fn download_family(
    client: &reqwest::Client,
    family: &Family,
    root: &Path,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(DownloadProgress) + Send + Sync),
) -> Result<(), FontError> {
    let total = family.bytes();
    let dir = root.join(family.id);
    let mut before = 0u64;
    for f in family.files.iter().chain(std::iter::once(&family.licence)) {
        download_file(client, f.url, f.size, f.sha256, &dir.join(f.name), cancel, &mut |n| on_progress(DownloadProgress { done: before + n, total })).await?;
        before += f.size;
    }
    Ok(())
}

/// The body of `fonts_download`. `client` builds the HTTP client, so tests can use one that talks to a loopback server.
async fn download_job(
    jobs: &AudioJobs,
    family: Option<&Family>,
    font_id: &str,
    job_id: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
    root: Option<PathBuf>,
    client: fn() -> Result<reqwest::Client, crate::audio::error::AudioError>,
) -> Result<(), FontError> {
    let family = family.ok_or_else(|| FontError::UnknownFont { font: font_id.to_string() })?;
    let root = require_root(root)?;
    // The mark's name cannot be a voice pack id: the audio and font downloads share one set.
    let _running = jobs.begin_download(&format!("font:{}", family.id)).ok_or_else(|| other("this font is already downloading"))?;
    let flag = jobs.flag(&job_id);
    let client = client()?;
    download_family(&client, family, &root, &flag, &|p| {
        let _ = on_progress.send(p);
    })
    .await
}

/// Downloads a catalog family. Stop it with `fonts_cancel(job_id)`; a stopped or failed download resumes on the next call.
#[tauri::command]
pub async fn fonts_download(
    state: tauri::State<'_, AudioJobs>,
    font_id: String,
    job_id: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), FontError> {
    download_job(&state, find_family(&font_id), &font_id, job_id, on_progress, fonts_root(), build_client).await
}

#[tauri::command]
pub fn fonts_cancel(state: tauri::State<'_, AudioJobs>, job_id: String) {
    state.cancel(&job_id);
}

/// The font file the author picked with `pick_font_file`; any other path is refused (the webview cannot name a file).
fn picked_font(picked: &PickedPaths, src_path: &str) -> Result<PathBuf, FontError> {
    picked.require(PickKind::Font, &PathBuf::from(src_path)).map_err(|_| invalid("choose the font file with the Import font button"))
}

/// Copies a `.ttf` or `.otf` file the author chose (`pick_font_file`) into the fonts folder.
#[tauri::command]
pub async fn fonts_import(picked: tauri::State<'_, PickedPaths>, src_path: String) -> Result<InstalledFont, FontError> {
    let src = picked_font(&picked, &src_path)?;
    let root = require_root(fonts_root())?;
    crate::platform::blocking(move || import_font(&src, &root)).await
}

#[tauri::command]
pub async fn fonts_delete(font_id: String) -> Result<(), FontError> {
    let root = require_root(fonts_root())?;
    crate::platform::blocking(move || delete_font(&root, &font_id)).await
}

/// The bytes of one installed font file (a raw IPC response, not JSON).
#[tauri::command]
pub async fn fonts_data(font_id: String, file: String) -> Result<tauri::ipc::Response, FontError> {
    let root = require_root(fonts_root())?;
    crate::platform::blocking(move || read_font_file(&root, &font_id, &file).map(tauri::ipc::Response::new)).await
}

#[cfg(test)]
mod tests;

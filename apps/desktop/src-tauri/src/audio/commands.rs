//! The Tauri command layer for the audiobook export and the voice packs. Work runs on Tauri's blocking pool.
use super::download::{build_client, download_pack, DownloadProgress};
use super::engine::{find_ffmpeg, find_sherpa};
use super::m4b::{build_m4b, BuiltM4b, M4bRequest};
use super::error::{other, AudioError};
use super::jobs::{voices_root, AudioJobs};
use super::packs::{delete_pack, find_pack, list_packs, PackInfo};
use super::render::{render_chapter, render_sample, ChapterRequest, RenderedChapter, SampleRequest};
use super::voices::{list_voices, VoiceInfo};
use std::path::PathBuf;

#[tauri::command]
pub async fn audio_voices() -> Result<Vec<VoiceInfo>, AudioError> {
    crate::platform::blocking(|| Ok(list_voices(voices_root().as_deref()))).await
}

/// Renders one chapter off the UI thread and reports 0..1 progress on `on_progress`.
#[tauri::command]
pub async fn audio_render_chapter(state: tauri::State<'_, AudioJobs>, request: ChapterRequest, on_progress: tauri::ipc::Channel<f64>) -> Result<RenderedChapter, AudioError> {
    let flag = state.flag(&request.job_id);
    crate::platform::blocking(move || {
        let sherpa = find_sherpa()?;
        render_chapter(&request, &sherpa, voices_root().as_deref(), &flag, &|f| {
            let _ = on_progress.send(f);
        })
    })
    .await
}

/// Renders a short sample off the UI thread and returns the WAV bytes (a raw IPC response, not JSON).
#[tauri::command]
pub async fn audio_sample(state: tauri::State<'_, AudioJobs>, request: SampleRequest) -> Result<tauri::ipc::Response, AudioError> {
    let flag = state.flag(&request.job_id);
    crate::platform::blocking(move || {
        let sherpa = find_sherpa()?;
        render_sample(&request, &sherpa, voices_root().as_deref(), &flag).map(tauri::ipc::Response::new)
    })
    .await
}

/// Builds the whole-book M4B from the chapter parts off the UI thread. Stop it with `audio_cancel`.
#[tauri::command]
pub async fn audio_build_m4b(state: tauri::State<'_, AudioJobs>, request: M4bRequest) -> Result<BuiltM4b, AudioError> {
    let flag = state.flag(&request.job_id);
    crate::platform::blocking(move || {
        let ffmpeg = find_ffmpeg()?;
        build_m4b(&request, &ffmpeg, &flag)
    })
    .await
}

#[tauri::command]
pub fn audio_cancel(state: tauri::State<'_, AudioJobs>, job_id: String) {
    state.cancel(&job_id);
}

/// Drops a finished job's flag. The TypeScript side calls it when an export ends, whatever the outcome.
#[tauri::command]
pub fn audio_forget(state: tauri::State<'_, AudioJobs>, job_id: String) {
    state.forget(&job_id);
}

/// Which of these project-relative paths are existing regular files. Used to trust a cached chapter only while its
/// audio files are still on disk. A path outside the project is refused like everywhere else.
pub(crate) fn files_exist(root: &std::path::Path, paths: &[String]) -> Result<Vec<bool>, AudioError> {
    paths
        .iter()
        .map(|rel| Ok(crate::project::resolve(root, rel)?.symlink_metadata().map(|m| m.is_file()).unwrap_or(false)))
        .collect()
}

#[tauri::command]
pub async fn audio_files_exist(root: String, paths: Vec<String>) -> Result<Vec<bool>, AudioError> {
    crate::platform::blocking(move || files_exist(std::path::Path::new(&root), &paths)).await
}

fn require_root() -> Result<PathBuf, AudioError> {
    voices_root().ok_or_else(|| other("there is no folder for voices on this computer"))
}

#[tauri::command]
pub async fn audio_packs() -> Result<Vec<PackInfo>, AudioError> {
    crate::platform::blocking(|| Ok(list_packs(voices_root().as_deref()))).await
}

/// Downloads a voice pack. `on_progress` gets the bytes of the whole pack. Stop it with `audio_cancel(job_id)`; a stopped
/// or failed download resumes on the next call.
#[tauri::command]
pub async fn audio_download_pack(state: tauri::State<'_, AudioJobs>, pack: String, job_id: String, on_progress: tauri::ipc::Channel<DownloadProgress>) -> Result<(), AudioError> {
    let pack = find_pack(&pack)?;
    let root = require_root()?;
    let flag = state.flag(&job_id);
    let client = build_client()?;
    download_pack(&client, pack, &root, &flag, &|p| {
        let _ = on_progress.send(p);
    })
    .await
}

#[tauri::command]
pub async fn audio_delete_pack(pack: String) -> Result<(), AudioError> {
    let pack = find_pack(&pack)?;
    let root = require_root()?;
    crate::platform::blocking(move || delete_pack(pack, &root)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_exist_reports_files_only_and_refuses_outside_paths() {
        let dir = std::env::temp_dir().join(format!("cc-exist-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.opus"), b"x").unwrap();
        let got = files_exist(&dir, &["a.opus".into(), "missing.opus".into(), "sub".into()]).unwrap();
        assert_eq!(got, vec![true, false, false]);
        assert!(files_exist(&dir, &["../a.opus".into()]).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

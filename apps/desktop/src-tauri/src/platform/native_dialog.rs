//! The native file and folder dialogs, opened from Rust so the path an author picks is known here and not only to the webview.
//! This is OS UI that needs a real window and a person, so it has no unit test (it is excluded in `scripts/coverage.mjs`);
//! everything around it (recording, checking, the dev-automation queue) is tested.
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

/// What a dialog asks for. Mirrors the extension filters the webview pickers used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ask {
    Folder,
    Image,
    ImportSource,
}

/// Opens the dialog and waits for the answer (None is a cancel). Blocks, so call it from the blocking pool, never the UI thread.
#[cfg_attr(test, allow(dead_code))] // tests answer through `commands::fake_dialog`
pub fn ask<R: Runtime>(app: &AppHandle<R>, what: Ask) -> Option<PathBuf> {
    let dialog = app.dialog().file();
    let chosen = match what {
        Ask::Folder => dialog.blocking_pick_folder(),
        Ask::Image => dialog.add_filter("Images", &crate::project::IMAGE_EXTENSIONS).blocking_pick_file(),
        Ask::ImportSource => dialog.add_filter("Documents", &["docx", "md", "markdown", "html", "htm"]).blocking_pick_file(),
    };
    chosen.and_then(|p| p.into_path().ok())
}

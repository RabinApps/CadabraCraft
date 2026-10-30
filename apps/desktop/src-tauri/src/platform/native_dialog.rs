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
    /// Any files, several at once (references).
    References,
    /// One `.ttf` or `.otf`.
    Font,
}

/// Opens the dialog and waits for the answer (empty is a cancel; only `References` can return more than one path). Blocks, so call it from the blocking pool, never the UI thread.
#[cfg_attr(test, allow(dead_code))] // tests answer through `commands::fake_dialog`
pub fn ask<R: Runtime>(app: &AppHandle<R>, what: Ask) -> Vec<PathBuf> {
    let dialog = app.dialog().file();
    let chosen = match what {
        Ask::Folder => dialog.blocking_pick_folder().into_iter().collect::<Vec<_>>(),
        Ask::Image => dialog.add_filter("Images", &crate::project::IMAGE_EXTENSIONS).blocking_pick_file().into_iter().collect(),
        Ask::ImportSource => dialog.add_filter("Documents", &["docx", "md", "markdown", "html", "htm"]).blocking_pick_file().into_iter().collect(),
        Ask::References => dialog.blocking_pick_files().unwrap_or_default(),
        Ask::Font => dialog.add_filter("Fonts", &["ttf", "otf"]).blocking_pick_file().into_iter().collect(),
    };
    chosen.into_iter().filter_map(|p| p.into_path().ok()).collect()
}

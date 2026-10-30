//! Fonts the author can add: a catalog of open-licence families to download (see `catalog`) and `.ttf`/`.otf` files to
//! import. This is the third network use in the app (after the update check and the voice download) and only happens
//! after the author clicks Download; see docs/architecture.md, "Font download".
//!
//! Layout on disk, under `<app data>/fonts/`: `<catalog id>/<font files and OFL.txt>` for downloads and
//! `imported/<slug>/<font files>` for imports. Typst gets this folder as a second `--font-path`, so PDF export sees
//! both; the editor reads a font's bytes through `fonts_data` and registers an `@font-face` from a `data:` URL.
//!
//! Layout: `catalog` (pinned families), `import` (name-table parser and import), `store` (what is installed, delete,
//! read), `error`, `commands` (the Tauri layer). Downloads reuse `audio::download::download_file`, and the cancel flags
//! are the audio ones (`AudioJobs`).
pub mod catalog;
pub mod commands;
pub mod error;
pub mod import;
pub mod store;

use std::path::PathBuf;
use std::sync::OnceLock;

static FONTS_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Where downloaded and imported fonts live (set once at startup to the app data folder). `CADABRA_FONTS_DIR`
/// overrides it for tests and development.
pub fn set_fonts_dir(dir: PathBuf) {
    let _ = FONTS_DIR.set(dir);
}

pub(crate) fn fonts_root() -> Option<PathBuf> {
    std::env::var_os("CADABRA_FONTS_DIR")
        .map(PathBuf::from)
        .or_else(|| FONTS_DIR.get().cloned())
}

/// The folder to hand to Typst as `--font-path`: only when it exists (nothing was downloaded or imported before).
pub fn typst_font_dir() -> Option<PathBuf> {
    fonts_root().filter(|d| d.is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fonts_folder_is_set_once_and_the_override_wins() {
        let first = std::env::temp_dir().join("cadabracraft-test-fonts");
        set_fonts_dir(first.clone());
        set_fonts_dir(std::env::temp_dir().join("cadabracraft-other-fonts")); // the first one stays
        assert_eq!(FONTS_DIR.get(), Some(&first));
        let expected = std::env::var_os("CADABRA_FONTS_DIR")
            .map(PathBuf::from)
            .unwrap_or(first);
        assert_eq!(fonts_root(), Some(expected.clone()));
        // Typst only gets a folder that exists.
        assert_eq!(
            typst_font_dir(),
            Some(expected.clone()).filter(|d| d.is_dir())
        );
    }
}

#[cfg(test)]
mod edge_tests;

//! Runs the `typst` CLI for PDF export. A copy ships with the app as a sidecar next to the executable (see
//! `bundle.externalBin`), so users install nothing; release builds run only that copy (the webview cannot choose the program); debug builds also honour
//! `TYPST_BIN` and PATH. Nothing is downloaded at runtime: Typst runs with empty package folders and a source that
//! imports a package is refused. The TypeScript side
//! (`@cadabracraft/export-pdf`) builds the Typst source and checks fonts; this layer only runs the binary safely.
//! Arguments are always passed as an array (no shell), and every compile happens in a fresh temp directory that
//! is removed afterwards, whatever the outcome.
//!
//! Layout: `engine` (find the program, compile, fonts), `request` (the framed binary compile request), `error` and
//! `commands` (the Tauri layer).
pub mod commands;
pub mod engine;
pub mod error;
pub mod request;

pub use engine::set_font_dir;

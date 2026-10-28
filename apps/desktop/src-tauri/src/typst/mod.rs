//! Runs the `typst` CLI for PDF export. A copy ships with the app as a sidecar next to the executable (see
//! `bundle.externalBin`), so users install nothing; an explicit path or `TYPST_BIN` overrides it, and PATH or the
//! usual Homebrew locations are the last resort. Nothing is downloaded at runtime. The TypeScript side
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

//! Tauri command handlers. Every file command runs on the blocking thread pool (`platform::blocking`) so disk IO, hashing
//! and large reads never stall the UI. Errors are `ProjectError` (`{ kind, ...params }`, see `project/error.rs`).
//! The audio and typst commands live in `audio/commands.rs` and `typst/commands.rs`.
mod app;
mod assets;
mod import;
mod project;
mod snapshots;
mod wire;

pub use app::*;
pub use assets::*;
pub use import::*;
pub use project::*;
pub use snapshots::*;

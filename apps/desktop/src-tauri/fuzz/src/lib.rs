//! The app's parsers, compiled for fuzzing without the app crate (its build script needs the sidecar binaries, and
//! `cadabracraft_lib` exports nothing but `run()`). The real source files are included with `#[path]`; `tauri` is the
//! small stand-in crate in `tools/perf/tauri-shim` (the sources only name `tauri::Url` and `tauri::Error`).
//!
//! If the app crate ever exposes these modules (for example behind `#[cfg(fuzzing)] pub mod fuzz_api;` in lib.rs), this
//! file can shrink to a re-export and the shim can go.
#![allow(dead_code, unused_imports)]

#[path = "../../src/import_docx/mod.rs"]
pub mod import_docx;
#[path = "../../src/project/mod.rs"]
pub mod project;

pub mod audio;
pub mod fonts;
pub mod platform;
pub mod typst;

/// `project::check_image` (which calls `image_size`) is `pub(crate)`, so it is reachable from inside this crate only.
pub fn check_image(name: &str, ext: &str, bytes: &[u8]) -> bool {
    project::check_image(name, ext, bytes).is_ok()
}

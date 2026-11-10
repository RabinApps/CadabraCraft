//! Validates an exported EPUB with EPUBCheck (the W3C reference validator, a Java program). A copy of EPUBCheck and a trimmed Java
//! runtime (`jlink`) ship with the app as resources next to the executable (see `bundle.resources`), so authors install nothing and
//! nothing is downloaded or sent anywhere: the checker reads one local file. Release builds run only the bundled copy (the webview
//! cannot choose the program or the file outside the book folder); debug builds also honour `EPUBCHECK_DIR`, `JAVA_BIN` and PATH.
//!
//! Layout: `engine` (find the runtime, run the checker), `report` (EPUBCheck's JSON report as plain data), `error` and `commands`
//! (the Tauri layer). Arguments are always passed as an array (no shell) and every run uses a fresh temp folder that is removed afterwards.
pub mod commands;
pub mod engine;
pub mod error;
pub mod report;

pub use commands::EpubcheckJob;
pub use engine::set_resource_dir;

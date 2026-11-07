//! Tauri command handlers. Every file command runs on the blocking thread pool (`platform::blocking`) so disk IO, hashing
//! and large reads never stall the UI. Errors are `ProjectError` (`{ kind, ...params }`, see `project/error.rs`).
//! The audio and typst commands live in `audio/commands.rs` and `typst/commands.rs`.
mod app;
mod assets;
mod import;
mod library;
mod media;
mod picked;
mod project;
mod references;
mod snapshots;
mod wire;

pub use app::*;
pub use assets::*;
pub use import::*;
pub use library::*;
pub use media::*;
pub use picked::*;
pub use project::*;
pub use references::*;
pub use snapshots::*;

/// Helpers shared by the tests of the command layers (`commands`, `typst::commands`, `audio::commands`).
#[cfg(test)]
pub(crate) mod testutil {
    use tauri::ipc::{InvokeResponseBody, IpcResponse, Response};

    /// Runs a command future to completion (the commands that take no `State`/`AppHandle` are plain async functions).
    pub fn run<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    /// A folder with a `cadabra.json`, which is what makes it a project.
    pub fn project() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("cadabra.json"), "{}").unwrap();
        d
    }

    pub fn root(d: &tempfile::TempDir) -> String {
        d.path().to_string_lossy().into_owned()
    }

    /// The body of an IPC response as bytes (a JSON body as its UTF-8 text).
    pub fn raw(r: Response) -> Vec<u8> {
        match IpcResponse::body(r).unwrap() {
            InvokeResponseBody::Raw(v) => v,
            InvokeResponseBody::Json(j) => j.into_bytes(),
        }
    }

    /// A message body as text (a binary one lossily).
    pub fn text(body: InvokeResponseBody) -> String {
        match body {
            InvokeResponseBody::Json(j) => j,
            InvokeResponseBody::Raw(v) => String::from_utf8_lossy(&v).into_owned(),
        }
    }

    #[test]
    fn raw_reads_binary_and_json_bodies() {
        assert_eq!(raw(Response::new(vec![1u8, 2])), vec![1, 2]);
        assert_eq!(text(InvokeResponseBody::Json("{}".into())), "{}");
        assert_eq!(text(InvokeResponseBody::Raw(b"ab".to_vec())), "ab");
        assert_eq!(raw(Response::new("{}".to_string())), b"{}");
    }
}

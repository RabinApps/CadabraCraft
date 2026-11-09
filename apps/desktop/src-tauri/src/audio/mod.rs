//! Audiobook synthesis with the `sherpa-onnx-offline-tts` CLI, which runs both Kokoro and Piper voices. The program
//! and the voice files are looked up, never downloaded here (except by the voice-pack download the author asks for); a
//! voice is "installed" when its files exist under the voices folder (the layout of the sherpa model archives,
//! extracted side by side). The TypeScript side (`@cadabracraft/export-audio`) narrates and chunks the text and decides
//! the order; this layer renders one chapter per call, off the UI thread, and is the only place that starts processes.
//!
//! Threading: every command is `async` and runs its work on Tauri's blocking pool (`platform::blocking`), so the webview
//! and the async runtime never stall. A job id maps to a cancel flag (`AudioJobs`); the polling loop that waits for the
//! engine checks it every 20 ms and kills the process, so Cancel takes effect within a fraction of a second. Progress
//! goes back over a `Channel`. Arguments are always an array (no shell), the engine's output goes to a temp dir that is
//! removed on every path, and the finished file is written atomically under `exports/` of the project.
//!
//! Layout: `voices` (catalog), `batch` (chunk planning, engine args), `wav`, `encode` (FLAC/Opus), `engine` (process),
//! `render` (chapter and sample), `loudness` (integrated LUFS and true peak of a chapter), `m4b` (the whole-book MP4 audiobook through ffmpeg), `jobs` (cancel flags, voices folder), `error`, `packs` (download catalog),
//! `download` (resumable HTTPS downloader) and `commands` (the Tauri layer).
pub mod batch;
pub mod commands;
pub mod download;
pub mod encode;
pub mod engine;
pub mod error;
pub mod jobs;
pub mod loudness;
pub mod m4b;
pub mod packs;
pub mod render;
pub mod voices;
pub mod wav;

pub use jobs::{set_voices_dir, AudioJobs};

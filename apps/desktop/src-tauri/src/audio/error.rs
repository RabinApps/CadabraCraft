//! The error type every audio command returns.
use crate::platform::sidecar::RunError;
use crate::project::ProjectError;
use serde::Serialize;

/// Errors sent to the UI as `{ kind, ... }` so it can show a specific, actionable message.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AudioError {
    NotFound { message: String },
    /// The voice is unknown or its files are not installed.
    VoiceMissing { voice: String },
    /// The engine ran and failed (its output).
    Synth { message: String },
    Encode { format: String, message: String },
    DiskFull,
    Timeout { seconds: u64 },
    Cancelled,
    /// A voice download failed (network, server answer, or the download ended early). The partial file is kept for a retry.
    Download { message: String },
    /// A downloaded voice file did not match its pinned sha256 and was deleted.
    Checksum { file: String },
    Other { message: String },
}

pub(crate) fn other(m: impl std::fmt::Display) -> AudioError {
    AudioError::Other { message: m.to_string() }
}

impl From<tauri::Error> for AudioError {
    fn from(e: tauri::Error) -> Self {
        other(e)
    }
}

impl From<RunError> for AudioError {
    fn from(e: RunError) -> Self {
        match e {
            RunError::NotFound(message) => AudioError::NotFound { message },
            RunError::Timeout { seconds } => AudioError::Timeout { seconds },
            RunError::Cancelled => AudioError::Cancelled,
            RunError::Other(message) => AudioError::Other { message },
        }
    }
}

impl From<ProjectError> for AudioError {
    fn from(e: ProjectError) -> Self {
        match e {
            ProjectError::DiskFull { .. } => AudioError::DiskFull,
            e => other(e),
        }
    }
}

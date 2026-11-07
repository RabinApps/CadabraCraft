//! The error type every audio command returns.
use crate::platform::sidecar::RunError;
use crate::project::ProjectError;
use serde::Serialize;

/// Errors sent to the UI as `{ kind, ... }` so it can show a specific, actionable message.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AudioError {
    NotFound {
        message: String,
    },
    /// The voice is unknown or its files are not installed.
    VoiceMissing {
        voice: String,
    },
    /// The engine ran and failed (its output).
    Synth {
        message: String,
    },
    Encode {
        format: String,
        message: String,
    },
    DiskFull,
    Timeout {
        seconds: u64,
    },
    Cancelled,
    /// A voice download failed (network, server answer, or the download ended early). The partial file is kept for a retry.
    Download {
        message: String,
    },
    /// A downloaded voice file did not match its pinned sha256 and was deleted.
    Checksum {
        file: String,
    },
    Other {
        message: String,
    },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_as_a_kind_with_its_fields() {
        assert_eq!(serde_json::to_value(AudioError::DiskFull).unwrap(), serde_json::json!({ "kind": "disk_full" }));
        assert_eq!(serde_json::to_value(AudioError::Checksum { file: "a".into() }).unwrap(), serde_json::json!({ "kind": "checksum", "file": "a" }));
        assert_eq!(serde_json::to_value(other("boom")).unwrap(), serde_json::json!({ "kind": "other", "message": "boom" }));
    }

    #[test]
    fn a_failed_blocking_task_becomes_an_other_error() {
        let e = tauri::async_runtime::block_on(async { tauri::async_runtime::spawn_blocking(|| -> u8 { panic!("worker died") }).await.unwrap_err() });
        assert!(matches!(AudioError::from(e), AudioError::Other { .. }));
    }

    #[test]
    fn run_errors_keep_their_kind() {
        assert_eq!(AudioError::from(RunError::NotFound("n".into())), AudioError::NotFound { message: "n".into() });
        assert_eq!(AudioError::from(RunError::Timeout { seconds: 3 }), AudioError::Timeout { seconds: 3 });
        assert_eq!(AudioError::from(RunError::Cancelled), AudioError::Cancelled);
        assert_eq!(AudioError::from(RunError::Other("o".into())), AudioError::Other { message: "o".into() });
    }

    #[test]
    fn only_a_full_disk_keeps_its_kind_among_project_errors() {
        assert_eq!(AudioError::from(ProjectError::DiskFull { path: "a.opus".into() }), AudioError::DiskFull);
        assert!(matches!(AudioError::from(ProjectError::UnsafePath { path: "../a".into() }), AudioError::Other { message } if message.contains("../a")));
    }
}

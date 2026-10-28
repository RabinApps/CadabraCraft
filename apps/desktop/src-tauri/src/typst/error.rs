//! The error type every typst command returns.
use crate::platform::sidecar::RunError;
use serde::Serialize;

/// Errors sent to the UI as `{ kind, ... }` so it can show a specific, actionable message.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TypstError {
    NotFound { message: String },
    Timeout { seconds: u64 },
    /// Typst ran and reported errors (its stderr).
    Compile { message: String },
    /// Typst substituted an unknown font family; the export is refused.
    Font { family: String },
    Other { message: String },
}

pub(crate) fn other(m: impl std::fmt::Display) -> TypstError {
    TypstError::Other { message: m.to_string() }
}

impl From<tauri::Error> for TypstError {
    fn from(e: tauri::Error) -> Self {
        other(e)
    }
}

impl From<RunError> for TypstError {
    fn from(e: RunError) -> Self {
        match e {
            RunError::NotFound(message) => TypstError::NotFound { message },
            RunError::Timeout { seconds } => TypstError::Timeout { seconds },
            // Typst runs are never given a cancel flag.
            RunError::Cancelled => other("the typst run was cancelled"),
            RunError::Other(message) => TypstError::Other { message },
        }
    }
}

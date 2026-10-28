//! The error type every typst command returns.
use crate::platform::sidecar::RunError;
use serde::Serialize;

/// Errors sent to the UI as `{ kind, ... }` so it can show a specific, actionable message.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TypstError {
    NotFound {
        message: String,
    },
    Timeout {
        seconds: u64,
    },
    /// Typst ran and reported errors (its stderr).
    Compile {
        message: String,
    },
    /// Typst substituted an unknown font family; the export is refused.
    Font {
        family: String,
    },
    Other {
        message: String,
    },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_as_a_kind_with_its_fields() {
        assert_eq!(serde_json::to_value(TypstError::Font { family: "X".into() }).unwrap(), serde_json::json!({ "kind": "font", "family": "X" }));
        assert_eq!(serde_json::to_value(other("boom")).unwrap(), serde_json::json!({ "kind": "other", "message": "boom" }));
    }

    #[test]
    fn a_failed_blocking_task_becomes_an_other_error() {
        let e = tauri::async_runtime::block_on(async { tauri::async_runtime::spawn_blocking(|| -> u8 { panic!("worker died") }).await.unwrap_err() });
        assert!(matches!(TypstError::from(e), TypstError::Other { .. }));
    }

    #[test]
    fn run_errors_keep_their_kind() {
        assert_eq!(TypstError::from(RunError::NotFound("n".into())), TypstError::NotFound { message: "n".into() });
        assert_eq!(TypstError::from(RunError::Timeout { seconds: 3 }), TypstError::Timeout { seconds: 3 });
        assert_eq!(TypstError::from(RunError::Cancelled), other("the typst run was cancelled"));
        assert_eq!(TypstError::from(RunError::Other("o".into())), TypstError::Other { message: "o".into() });
    }
}

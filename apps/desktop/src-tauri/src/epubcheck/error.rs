//! The error type every EPUBCheck command returns, sent to the UI as `{ kind, ... }` (the UI writes the words).
use crate::platform::sidecar::RunError;
use crate::project::ProjectError;
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EpubcheckError {
    /// The bundled checker or its Java runtime is missing.
    NotFound {
        message: String,
    },
    Timeout {
        seconds: u64,
    },
    Cancelled,
    /// There is no EPUB at that path in the book folder.
    NoEpub,
    /// The checker ran but left no report (its output tail is in `message`).
    Failed {
        message: String,
    },
    Other {
        message: String,
    },
}

pub(crate) fn other(m: impl std::fmt::Display) -> EpubcheckError {
    EpubcheckError::Other { message: m.to_string() }
}

impl From<tauri::Error> for EpubcheckError {
    fn from(e: tauri::Error) -> Self {
        other(e)
    }
}

impl From<RunError> for EpubcheckError {
    fn from(e: RunError) -> Self {
        match e {
            RunError::NotFound(message) => EpubcheckError::NotFound { message },
            RunError::Timeout { seconds } => EpubcheckError::Timeout { seconds },
            RunError::Cancelled => EpubcheckError::Cancelled,
            RunError::Other(message) => EpubcheckError::Other { message },
        }
    }
}

impl From<ProjectError> for EpubcheckError {
    fn from(e: ProjectError) -> Self {
        other(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_as_a_kind_with_its_fields() {
        assert_eq!(serde_json::to_value(EpubcheckError::Timeout { seconds: 9 }).unwrap(), serde_json::json!({ "kind": "timeout", "seconds": 9 }));
        assert_eq!(serde_json::to_value(EpubcheckError::Cancelled).unwrap(), serde_json::json!({ "kind": "cancelled" }));
        assert_eq!(serde_json::to_value(EpubcheckError::NoEpub).unwrap(), serde_json::json!({ "kind": "no_epub" }));
    }

    #[test]
    fn a_project_error_becomes_an_other_error() {
        let e = EpubcheckError::from(ProjectError::NotFound { path: "exports/book.epub".into() });
        assert!(matches!(e, EpubcheckError::Other { ref message } if !message.is_empty()), "{e:?}");
    }

    #[test]
    fn run_errors_map_onto_their_kinds() {
        assert_eq!(EpubcheckError::from(RunError::Timeout { seconds: 3 }), EpubcheckError::Timeout { seconds: 3 });
        assert_eq!(EpubcheckError::from(RunError::Cancelled), EpubcheckError::Cancelled);
        assert_eq!(EpubcheckError::from(RunError::NotFound("x".into())), EpubcheckError::NotFound { message: "x".into() });
        assert_eq!(EpubcheckError::from(RunError::Other("y".into())), other("y"));
    }

    #[test]
    fn io_and_tauri_errors_become_other_with_their_text() {
        assert_eq!(other(std::io::Error::other("disk gone")), EpubcheckError::Other { message: "disk gone".into() });
        let from_tauri = EpubcheckError::from(tauri::Error::Io(std::io::Error::other("webview gone")));
        assert_eq!(from_tauri, EpubcheckError::Other { message: "webview gone".into() });
    }
}

//! The error type every font command returns.
use crate::audio::error::AudioError;
use serde::Serialize;

/// Errors sent to the UI as `{ kind, ... }`, like `AudioError`.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FontError {
    /// The download failed (network, server answer, or it ended early). The partial file is kept for a retry.
    Network {
        message: String,
    },
    /// A downloaded file did not match its pinned sha256 and was deleted.
    Checksum {
        file: String,
    },
    DiskFull,
    /// No such font in the catalog or on this computer (or a file name that is not one of its files).
    UnknownFont {
        font: String,
    },
    /// An imported file is not a usable `.ttf`/`.otf` (wrong type, too large, no family name).
    InvalidFont {
        message: String,
    },
    Cancelled,
    Other {
        message: String,
    },
}

pub(crate) fn other(m: impl std::fmt::Display) -> FontError {
    FontError::Other {
        message: m.to_string(),
    }
}

pub(crate) fn invalid(m: impl std::fmt::Display) -> FontError {
    FontError::InvalidFont {
        message: m.to_string(),
    }
}

pub(crate) fn io_err(e: std::io::Error) -> FontError {
    use std::io::ErrorKind::*;
    match e.kind() {
        StorageFull | QuotaExceeded => FontError::DiskFull,
        _ => other(e),
    }
}

impl From<tauri::Error> for FontError {
    fn from(e: tauri::Error) -> Self {
        other(e)
    }
}

/// The downloader is shared with the voices and speaks `AudioError`.
impl From<AudioError> for FontError {
    fn from(e: AudioError) -> Self {
        match e {
            AudioError::Download { message } => FontError::Network { message },
            AudioError::Checksum { file } => FontError::Checksum { file },
            AudioError::DiskFull => FontError::DiskFull,
            AudioError::Cancelled => FontError::Cancelled,
            AudioError::Other { message } => FontError::Other { message },
            e => other(format!("{e:?}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn errors_serialize_as_a_kind_with_its_fields() {
        assert_eq!(
            serde_json::to_value(FontError::DiskFull).unwrap(),
            json!({ "kind": "disk_full" })
        );
        assert_eq!(
            serde_json::to_value(FontError::Cancelled).unwrap(),
            json!({ "kind": "cancelled" })
        );
        assert_eq!(
            serde_json::to_value(FontError::Checksum { file: "a".into() }).unwrap(),
            json!({ "kind": "checksum", "file": "a" })
        );
        assert_eq!(
            serde_json::to_value(FontError::Network {
                message: "m".into()
            })
            .unwrap(),
            json!({ "kind": "network", "message": "m" })
        );
        assert_eq!(
            serde_json::to_value(FontError::UnknownFont { font: "f".into() }).unwrap(),
            json!({ "kind": "unknown_font", "font": "f" })
        );
        assert_eq!(
            serde_json::to_value(invalid("bad")).unwrap(),
            json!({ "kind": "invalid_font", "message": "bad" })
        );
        assert_eq!(
            serde_json::to_value(other("boom")).unwrap(),
            json!({ "kind": "other", "message": "boom" })
        );
    }

    #[test]
    fn download_errors_keep_their_meaning() {
        assert_eq!(
            FontError::from(AudioError::Download {
                message: "m".into()
            }),
            FontError::Network {
                message: "m".into()
            }
        );
        assert_eq!(
            FontError::from(AudioError::Checksum { file: "f".into() }),
            FontError::Checksum { file: "f".into() }
        );
        assert_eq!(FontError::from(AudioError::DiskFull), FontError::DiskFull);
        assert_eq!(FontError::from(AudioError::Cancelled), FontError::Cancelled);
        assert_eq!(
            FontError::from(AudioError::Other {
                message: "o".into()
            }),
            FontError::Other {
                message: "o".into()
            }
        );
        assert!(matches!(
            FontError::from(AudioError::Timeout { seconds: 3 }),
            FontError::Other { .. }
        ));
    }

    #[test]
    fn disk_full_io_errors_keep_their_kind_and_a_failed_task_becomes_other() {
        assert_eq!(
            io_err(std::io::Error::from(std::io::ErrorKind::StorageFull)),
            FontError::DiskFull
        );
        assert!(matches!(
            io_err(std::io::Error::from(std::io::ErrorKind::NotFound)),
            FontError::Other { .. }
        ));
        let e = tauri::async_runtime::block_on(async {
            tauri::async_runtime::spawn_blocking(|| -> u8 { panic!("worker died") })
                .await
                .unwrap_err()
        });
        assert!(matches!(FontError::from(e), FontError::Other { .. }));
    }
}

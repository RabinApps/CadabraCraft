pub use url::Url;

/// The only tauri error the sources name; its message is all they use.
#[derive(Debug)]
pub enum Error {
    FailedToReceiveMessage,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("failed to receive message")
    }
}

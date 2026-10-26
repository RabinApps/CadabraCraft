//! Typed errors for the project file layer. Sent to the UI as `{ "kind": "<snake_case code>", ...params }`, the same
//! shape as `TypstError`, so the UI can show a localized message from the code and its params. `Display` renders the
//! English fallback (also what the contract tests match against).
//!
//! Wire format: `{"kind":"unsafe_path","path":"../x"}`, `{"kind":"too_large","path":"a.png","max_mb":25}`,
//! `{"kind":"already_exists"}` (unit variants carry only `kind`).
use serde::Serialize;
use std::fmt;

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectError {
    /// A project-relative path that is empty, absolute, has `..`, a backslash or a NUL byte.
    UnsafePath { path: String },
    /// A path that is lexically fine but leaves the project folder through a symbolic link.
    PathEscape { path: String },
    NotFound { path: String },
    /// `create_project` on a folder that already holds a project.
    AlreadyExists,
    /// A project root that is not an absolute path, or a folder without a `cadabra.json` file.
    NotAProject { path: String },
    NotUtf8 { path: String },
    /// A cloud placeholder (`.name.icloud`) that has not finished downloading.
    IcloudPending { path: String },
    TooLarge { path: String, max_mb: u64 },
    NotAFile { path: String },
    /// An image whose extension is not allowlisted.
    UnsupportedImage { name: String },
    /// An image whose bytes do not match its extension.
    InvalidImage { name: String, ext: String },
    /// A document whose extension is not `.docx`, `.md`, `.markdown` or `.txt`.
    UnsupportedDocument { name: String },
    NotImageAsset { path: String },
    NotTrashPath { path: String },
    CannotRestore { path: String },
    /// A Markdown image reference that is absolute, has `..`, a backslash or a NUL byte.
    ImageRefNotAllowed { reference: String },
    ImageRefNotFound { reference: String },
    ImageRefOutside { reference: String },
    InvalidFileName,
    /// Any other IO or runtime failure (the OS message).
    Io { message: String },
}

impl fmt::Display for ProjectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use ProjectError::*;
        match self {
            UnsafePath { path } => write!(f, "unsafe project path: {path}"),
            PathEscape { path } => write!(f, "{path} leaves the project folder through a symbolic link"),
            NotFound { path } => write!(f, "{path} does not exist"),
            AlreadyExists => write!(f, "a project already exists in this folder"),
            NotAProject { path } => write!(f, "{path} is not a CadabraCraft project folder"),
            NotUtf8 { path } => write!(f, "{path} is not valid UTF-8"),
            IcloudPending { path } => write!(f, "{path} is still downloading from iCloud; try again in a moment"),
            TooLarge { path, max_mb } => write!(f, "{path} is larger than {max_mb} MB"),
            NotAFile { path } => write!(f, "{path} is not a file"),
            UnsupportedImage { name } => write!(f, "unsupported image type: {name}"),
            InvalidImage { name, ext } => write!(f, "{name} is not a valid {ext} image"),
            UnsupportedDocument { name } => write!(f, "{name} is not a .docx, .md, .markdown or .txt file"),
            NotImageAsset { path } => write!(f, "not an image asset: {path}"),
            NotTrashPath { path } => write!(f, "not a trash path: {path}"),
            CannotRestore { path } => write!(f, "cannot restore {path}"),
            ImageRefNotAllowed { reference } => write!(f, "image path is not allowed: {reference}"),
            ImageRefNotFound { reference } => write!(f, "image not found: {reference}"),
            ImageRefOutside { reference } => write!(f, "image is outside the document folder: {reference}"),
            InvalidFileName => write!(f, "invalid file name"),
            Io { message } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for ProjectError {}

impl From<std::io::Error> for ProjectError {
    fn from(e: std::io::Error) -> Self {
        ProjectError::Io { message: e.to_string() }
    }
}

/// A failed `spawn_blocking` join (the task panicked or the runtime is shutting down).
impl From<tauri::Error> for ProjectError {
    fn from(e: tauri::Error) -> Self {
        ProjectError::Io { message: e.to_string() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_format_is_kind_tagged_snake_case() {
        let j = |e: ProjectError| serde_json::to_string(&e).unwrap();
        assert_eq!(j(ProjectError::UnsafePath { path: "../x".into() }), r#"{"kind":"unsafe_path","path":"../x"}"#);
        assert_eq!(j(ProjectError::TooLarge { path: "a.png".into(), max_mb: 25 }), r#"{"kind":"too_large","path":"a.png","max_mb":25}"#);
        assert_eq!(j(ProjectError::AlreadyExists), r#"{"kind":"already_exists"}"#);
        assert_eq!(j(ProjectError::NotAProject { path: "/x".into() }), r#"{"kind":"not_a_project","path":"/x"}"#);
        assert_eq!(j(ProjectError::IcloudPending { path: "a".into() }), r#"{"kind":"icloud_pending","path":"a"}"#);
        assert_eq!(j(ProjectError::ImageRefOutside { reference: "r".into() }), r#"{"kind":"image_ref_outside","reference":"r"}"#);
    }

    #[test]
    fn display_keeps_the_english_fallback() {
        assert_eq!(ProjectError::UnsafePath { path: "..".into() }.to_string(), "unsafe project path: ..");
        assert_eq!(ProjectError::from(std::io::Error::other("boom")).to_string(), "boom");
    }
}

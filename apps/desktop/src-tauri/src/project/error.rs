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
    /// A reference file whose type is never imported (programs, scripts and web pages that could run when opened).
    UnsupportedReference { name: String },
    /// A reference file whose bytes do not match its extension.
    InvalidReference { name: String, ext: String },
    /// A path that is not `references/<name>`.
    NotReference { path: String },
    NotTrashPath { path: String },
    CannotRestore { path: String },
    /// A Markdown image reference that is absolute, has `..`, a backslash or a NUL byte.
    ImageRefNotAllowed { reference: String },
    ImageRefNotFound { reference: String },
    ImageRefOutside { reference: String },
    InvalidFileName,
    /// A path the webview named for `create_project`, `import_asset` or `read_import_source` that the author never picked in a file dialog.
    NotPicked { name: String },
    /// The operating system refused access (file or folder permissions, read-only volume).
    PermissionDenied { path: String },
    /// The volume is full or the user's quota is used up.
    DiskFull { path: String },
    /// An image whose width times height is above `MAX_IMAGE_PIXELS` (a small file can still decode to gigabytes).
    ImageDimensions { name: String, max_megapixels: u64 },
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
            UnsupportedDocument { name } => write!(f, "{name} is not a .docx, .md, .markdown, .html, .htm or .txt file"),
            NotImageAsset { path } => write!(f, "not an image asset: {path}"),
            UnsupportedReference { name } => write!(f, "{name} is a type of file that cannot be added as a reference"),
            InvalidReference { name, ext } => write!(f, "{name} is not a valid {ext} file"),
            NotReference { path } => write!(f, "not a reference file: {path}"),
            NotTrashPath { path } => write!(f, "not a trash path: {path}"),
            CannotRestore { path } => write!(f, "cannot restore {path}"),
            ImageRefNotAllowed { reference } => write!(f, "image path is not allowed: {reference}"),
            ImageRefNotFound { reference } => write!(f, "image not found: {reference}"),
            ImageRefOutside { reference } => write!(f, "image is outside the document folder: {reference}"),
            InvalidFileName => write!(f, "invalid file name"),
            NotPicked { name } => write!(f, "{name} was not chosen in a file or folder dialog"),
            PermissionDenied { path } => write!(f, "no permission to access {path}"),
            DiskFull { path } => write!(f, "not enough disk space to write {path}"),
            ImageDimensions { name, max_megapixels } => write!(f, "{name} has more than {max_megapixels} megapixels"),
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

/// Maps an IO failure on `label` (a file name or project-relative path, never an absolute path) to the typed error the
/// UI can translate: permission, full disk, missing and not-a-file get their own codes, anything else stays `Io`.
pub fn io_error(e: std::io::Error, label: &str) -> ProjectError {
    use std::io::ErrorKind::*;
    let path = label.to_string();
    match e.kind() {
        PermissionDenied | ReadOnlyFilesystem => ProjectError::PermissionDenied { path },
        StorageFull | QuotaExceeded => ProjectError::DiskFull { path },
        NotFound => ProjectError::NotFound { path },
        NotADirectory | IsADirectory => ProjectError::NotAFile { path },
        _ => ProjectError::from(e),
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
    fn io_errors_get_typed_codes() {
        use std::io::{Error, ErrorKind};
        let k = |kind| io_error(Error::from(kind), "a.epub");
        assert_eq!(k(ErrorKind::PermissionDenied), ProjectError::PermissionDenied { path: "a.epub".into() });
        assert_eq!(k(ErrorKind::ReadOnlyFilesystem), ProjectError::PermissionDenied { path: "a.epub".into() });
        assert_eq!(k(ErrorKind::StorageFull), ProjectError::DiskFull { path: "a.epub".into() });
        assert_eq!(k(ErrorKind::QuotaExceeded), ProjectError::DiskFull { path: "a.epub".into() });
        assert_eq!(k(ErrorKind::NotFound), ProjectError::NotFound { path: "a.epub".into() });
        assert_eq!(k(ErrorKind::IsADirectory), ProjectError::NotAFile { path: "a.epub".into() });
        assert!(matches!(k(ErrorKind::TimedOut), ProjectError::Io { .. }));
        let j = |e: ProjectError| serde_json::to_string(&e).unwrap();
        assert_eq!(j(k(ErrorKind::StorageFull)), r#"{"kind":"disk_full","path":"a.epub"}"#);
        assert_eq!(j(k(ErrorKind::PermissionDenied)), r#"{"kind":"permission_denied","path":"a.epub"}"#);
        let dims = ProjectError::ImageDimensions { name: "a.png".into(), max_megapixels: 150 };
        assert_eq!(j(dims), r#"{"kind":"image_dimensions","name":"a.png","max_megapixels":150}"#);
    }

    #[test]
    fn display_keeps_the_english_fallback() {
        assert_eq!(ProjectError::UnsafePath { path: "..".into() }.to_string(), "unsafe project path: ..");
        assert_eq!(ProjectError::from(std::io::Error::other("boom")).to_string(), "boom");
    }

    #[test]
    fn every_variant_has_an_english_message_and_a_tauri_join_failure_is_io() {
        use ProjectError::*;
        let p = || "p".to_string();
        let all = vec![
            (UnsafePath { path: p() }, "unsafe project path: p"),
            (PathEscape { path: p() }, "p leaves the project folder through a symbolic link"),
            (NotFound { path: p() }, "p does not exist"),
            (AlreadyExists, "a project already exists in this folder"),
            (NotAProject { path: p() }, "p is not a CadabraCraft project folder"),
            (NotUtf8 { path: p() }, "p is not valid UTF-8"),
            (IcloudPending { path: p() }, "p is still downloading from iCloud; try again in a moment"),
            (TooLarge { path: p(), max_mb: 3 }, "p is larger than 3 MB"),
            (NotAFile { path: p() }, "p is not a file"),
            (UnsupportedImage { name: p() }, "unsupported image type: p"),
            (InvalidImage { name: p(), ext: "png".into() }, "p is not a valid png image"),
            (UnsupportedDocument { name: p() }, "p is not a .docx, .md, .markdown, .html, .htm or .txt file"),
            (NotImageAsset { path: p() }, "not an image asset: p"),
            (UnsupportedReference { name: p() }, "p is a type of file that cannot be added as a reference"),
            (InvalidReference { name: p(), ext: "pdf".into() }, "p is not a valid pdf file"),
            (NotReference { path: p() }, "not a reference file: p"),
            (NotTrashPath { path: p() }, "not a trash path: p"),
            (CannotRestore { path: p() }, "cannot restore p"),
            (ImageRefNotAllowed { reference: p() }, "image path is not allowed: p"),
            (ImageRefNotFound { reference: p() }, "image not found: p"),
            (ImageRefOutside { reference: p() }, "image is outside the document folder: p"),
            (InvalidFileName, "invalid file name"),
            (PermissionDenied { path: p() }, "no permission to access p"),
            (DiskFull { path: p() }, "not enough disk space to write p"),
            (ImageDimensions { name: p(), max_megapixels: 150 }, "p has more than 150 megapixels"),
            (Io { message: "boom".into() }, "boom"),
        ];
        for (e, text) in all {
            assert_eq!(e.to_string(), text);
        }
        let joined = ProjectError::from(tauri::Error::FailedToReceiveMessage);
        assert!(matches!(&joined, ProjectError::Io { message } if !message.is_empty()));
    }
}

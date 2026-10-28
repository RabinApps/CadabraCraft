//! Commands that read a document the user picked for import. Read-only.
use crate::platform::blocking;
use crate::project::ProjectError;
use std::path::PathBuf;
use tauri::ipc::Response;

/// Bytes of a document the user picked for import (.docx/.md/.markdown/.html/.htm/.txt, at most 200 MB). Read-only.
#[tauri::command]
pub async fn read_import_source(path: String) -> Result<Response, ProjectError> {
    blocking(move || crate::import_src::read_source(&PathBuf::from(path))).await.map(Response::new)
}

/// Bytes of an image a Markdown file references, resolved inside that file's folder. Read-only.
#[tauri::command]
pub async fn read_import_image(source_file: String, reference: String) -> Result<Response, ProjectError> {
    blocking(move || crate::import_src::read_relative_image(&PathBuf::from(source_file), &reference)).await.map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{raw, run};
    use super::*;

    #[test]
    fn a_document_and_the_image_it_references_are_read() {
        let dir = tempfile::tempdir().unwrap();
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];
        std::fs::write(dir.path().join("book.md"), "# Hi").unwrap();
        std::fs::write(dir.path().join("a.png"), png).unwrap();
        let md = dir.path().join("book.md").to_string_lossy().into_owned();
        assert_eq!(raw(run(read_import_source(md.clone())).unwrap()), b"# Hi");
        assert_eq!(raw(run(read_import_image(md, "a.png".into())).unwrap()), png);
    }

    #[test]
    fn unsupported_documents_and_unsafe_image_references_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("book.exe"), "x").unwrap();
        std::fs::write(dir.path().join("book.md"), "x").unwrap();
        assert!(run(read_import_source(dir.path().join("book.exe").to_string_lossy().into_owned())).is_err());
        assert!(run(read_import_image(dir.path().join("book.md").to_string_lossy().into_owned(), "../x.png".into())).is_err());
    }
}

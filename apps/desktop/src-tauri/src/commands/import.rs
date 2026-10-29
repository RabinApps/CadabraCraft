//! Commands that read a document the user picked for import. Read-only.
use super::{PickKind, PickedPaths};
use crate::platform::blocking;
use crate::project::ProjectError;
use std::path::PathBuf;
use tauri::ipc::Response;
use tauri::State;

/// `read_import_source`: the document must be one the author picked with `pick_import_source`.
fn source_picked(picked: &PickedPaths, path: &str) -> Result<Vec<u8>, ProjectError> {
    crate::import_src::read_source(&picked.require(PickKind::ImportSource, &PathBuf::from(path))?)
}

/// `read_import_image`: the Markdown file must be a picked import source, so only its own folder is read.
fn image_picked(picked: &PickedPaths, source_file: &str, reference: &str) -> Result<Vec<u8>, ProjectError> {
    crate::import_src::read_relative_image(&picked.require(PickKind::ImportSource, &PathBuf::from(source_file))?, reference)
}

/// Bytes of a document the user picked for import (`pick_import_source`; .docx/.md/.markdown/.html/.htm/.txt, at most 200 MB). Read-only.
#[tauri::command]
pub async fn read_import_source(picked: State<'_, PickedPaths>, path: String) -> Result<Response, ProjectError> {
    blocking({ let picked = picked.inner().clone(); move || source_picked(&picked, &path) }).await.map(Response::new)
}

/// Bytes of an image a picked Markdown file references, resolved inside that file's folder. Read-only.
#[tauri::command]
pub async fn read_import_image(picked: State<'_, PickedPaths>, source_file: String, reference: String) -> Result<Response, ProjectError> {
    blocking({ let picked = picked.inner().clone(); move || image_picked(&picked, &source_file, &reference) }).await.map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

    fn picked_md(dir: &tempfile::TempDir) -> (PickedPaths, String) {
        let picked = PickedPaths::default();
        std::fs::write(dir.path().join("book.md"), "# Hi").unwrap();
        std::fs::write(dir.path().join("a.png"), PNG).unwrap();
        picked.record(PickKind::ImportSource, &dir.path().join("book.md")).unwrap();
        (picked, dir.path().join("book.md").to_string_lossy().into_owned())
    }

    #[test]
    fn a_picked_document_and_the_image_it_references_are_read() {
        let dir = tempfile::tempdir().unwrap();
        let (picked, md) = picked_md(&dir);
        assert_eq!(source_picked(&picked, &md).unwrap(), b"# Hi");
        assert_eq!(image_picked(&picked, &md, "a.png").unwrap(), PNG);
    }

    #[test]
    fn unsupported_documents_unsafe_image_references_and_unpicked_files_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let (picked, md) = picked_md(&dir);
        let exe = dir.path().join("book.exe");
        std::fs::write(&exe, "x").unwrap();
        picked.record(PickKind::ImportSource, &exe).unwrap();
        assert!(matches!(source_picked(&picked, &exe.to_string_lossy()), Err(ProjectError::UnsupportedDocument { .. })));
        assert!(image_picked(&picked, &md, "../x.png").is_err());
        let other = dir.path().join("other.md");
        std::fs::write(&other, "secret").unwrap();
        let other = other.to_string_lossy();
        assert_eq!(source_picked(&picked, &other), Err(ProjectError::NotPicked { name: "other.md".into() }));
        assert!(matches!(image_picked(&picked, &other, "a.png"), Err(ProjectError::NotPicked { .. })));
        assert!(matches!(source_picked(&picked, "/no/such/book.md"), Err(ProjectError::NotPicked { .. })));
    }
}

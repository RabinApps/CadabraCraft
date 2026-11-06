//! Commands that read a document the user picked for import. Read-only.
use super::{PickKind, PickedPaths};
use crate::import_docx::{frame, import_docx_owned, Options};
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

/// `import_docx`: the Word document must be one the author picked; it is read, unzipped and parsed here and the reply is
/// the framed result (`import_docx::frame`). Nothing is written.
///
/// Peak memory (n = file size, at most 200 MB): the file bytes are handed to `import_docx_owned`, which frees them once the
/// archive is inflated; each XML part's inflated bytes are freed as soon as that part is parsed. So the file never
/// coexists with a DOM, and only media stay beside the trees. Worst case is about n + inflated parts while unzipping, then
/// inflated parts + trees (bounded by `Options::xml`) while parsing, then the framed reply (the images once more) at the
/// end; the full model is on `import_docx_owned`.
fn docx_picked(picked: &PickedPaths, path: &str, split_heading_level: u8) -> Result<Vec<u8>, ProjectError> {
    if !(1..=3).contains(&split_heading_level) {
        return Err(ProjectError::Io { message: "the split heading level must be 1, 2 or 3".into() });
    }
    let file = picked.require(PickKind::ImportSource, &PathBuf::from(path))?;
    let is_docx = file.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("docx"));
    if !is_docx {
        let name = file.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        return Err(ProjectError::UnsupportedDocument { name });
    }
    let bytes = crate::import_src::read_source(&file)?;
    let result = import_docx_owned(bytes, &Options { split_heading_level, ..Options::default() })?;
    frame::encode(&result).map_err(|e| ProjectError::Io { message: e.to_string() })
}

/// Bytes of a document the user picked for import (`pick_import_source`; .docx/.md/.markdown/.html/.htm/.txt, or an outline: .opml/.csv, at most 200 MB). Read-only; the webview parses it.
#[tauri::command]
pub async fn read_import_source(picked: State<'_, PickedPaths>, path: String) -> Result<Response, ProjectError> {
    blocking({
        let picked = picked.inner().clone();
        move || source_picked(&picked, &path)
    })
    .await
    .map(Response::new)
}

/// Bytes of an image a picked Markdown file references, resolved inside that file's folder. Read-only.
#[tauri::command]
pub async fn read_import_image(picked: State<'_, PickedPaths>, source_file: String, reference: String) -> Result<Response, ProjectError> {
    blocking({
        let picked = picked.inner().clone();
        move || image_picked(&picked, &source_file, &reference)
    })
    .await
    .map(Response::new)
}

/// Imports a picked `.docx` (`pick_import_source`) into chapters, warnings and images, in Rust. Reply: `import_docx::frame`
/// (header length, JSON header, image bytes). Fails with `import_docx { code }` for a file that is not a readable Word document.
#[tauri::command]
pub async fn import_docx_source(picked: State<'_, PickedPaths>, path: String, split_heading_level: u8) -> Result<Response, ProjectError> {
    blocking({
        let picked = picked.inner().clone();
        move || docx_picked(&picked, &path, split_heading_level)
    })
    .await
    .map(Response::new)
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

    #[test]
    fn a_picked_docx_is_imported_to_a_framed_reply_and_bad_ones_get_typed_errors() {
        use crate::import_docx::testutil::{chapter_body, simple_docx};
        let dir = tempfile::tempdir().unwrap();
        let picked = PickedPaths::default();
        let docx = dir.path().join("book.DOCX");
        std::fs::write(&docx, simple_docx(&chapter_body(), &[])).unwrap();
        std::fs::write(dir.path().join("junk.docx"), "not a zip, but long enough to look at").unwrap();
        std::fs::write(dir.path().join("book.md"), "# Hi").unwrap();
        for f in ["book.DOCX", "junk.docx", "book.md"] {
            picked.record(PickKind::ImportSource, &dir.path().join(f)).unwrap();
        }
        let at = |f: &str| dir.path().join(f).to_string_lossy().into_owned();
        let body = docx_picked(&picked, &at("book.DOCX"), 1).unwrap();
        let len = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
        let header: serde_json::Value = serde_json::from_slice(&body[4..4 + len]).unwrap();
        assert_eq!(header["chapters"].as_array().unwrap().len(), 2);
        let two = docx_picked(&picked, &at("book.DOCX"), 2).unwrap();
        let header: serde_json::Value = serde_json::from_slice(&two[4..4 + u32::from_le_bytes(two[..4].try_into().unwrap()) as usize]).unwrap();
        assert_eq!(header["chapters"][0]["title"], "Untitled", "no level 2 headings: one untitled chapter");
        assert_eq!(docx_picked(&picked, &at("junk.docx"), 1), Err(ProjectError::ImportDocx { code: "invalid-zip".into() }));
        assert!(matches!(docx_picked(&picked, &at("book.md"), 1), Err(ProjectError::UnsupportedDocument { .. })));
        assert!(matches!(docx_picked(&picked, &at("book.DOCX"), 0), Err(ProjectError::Io { .. })));
        assert!(matches!(docx_picked(&picked, &at("book.DOCX"), 4), Err(ProjectError::Io { .. })));
        assert!(matches!(docx_picked(&picked, &at("other.docx"), 1), Err(ProjectError::NotPicked { .. })));
    }
}

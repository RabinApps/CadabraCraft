//! Reference file commands (research files kept beside the book).
use super::{PickKind, PickedPaths};
use crate::platform::blocking;
use crate::project::{self, ImportedReference, ProjectError, ReferenceStat};
use std::path::PathBuf;
use tauri::ipc::Response;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

/// `import_reference`: the source must be a file the author picked with `pick_reference_files` or dropped on the window.
fn import_picked(picked: &PickedPaths, root: &str, source: &str) -> Result<ImportedReference, ProjectError> {
    project::import_reference(&project::require_project(&PathBuf::from(root))?, &picked.require(PickKind::Reference, &PathBuf::from(source))?)
}

/// Copies a file the user picked into `references/`; returns where it went and what it is. Any other source is refused.
#[tauri::command]
pub async fn import_reference(picked: State<'_, PickedPaths>, root: String, source: String) -> Result<ImportedReference, ProjectError> {
    blocking({ let picked = picked.inner().clone(); move || import_picked(&picked, &root, &source) }).await
}

/// Size and kind of `references/<name>`.
#[tauri::command]
pub async fn stat_reference(root: String, path: String) -> Result<ReferenceStat, ProjectError> {
    blocking(move || project::stat_reference(&project::require_project(&PathBuf::from(root))?, &path)).await
}

/// Up to `length` bytes of `references/<name>` from `offset`, sent as binary (never a JSON array).
#[tauri::command]
pub async fn read_reference(root: String, path: String, offset: u64, length: u64) -> Result<Response, ProjectError> {
    blocking(move || project::read_reference_range(&project::require_project(&PathBuf::from(root))?, &path, offset, length)).await.map(Response::new)
}

/// Moves `references/<name>` to `.cadabra/trash/`; returns the trash path.
#[tauri::command]
pub async fn trash_reference(root: String, path: String) -> Result<String, ProjectError> {
    blocking(move || project::trash_reference(&project::require_project(&PathBuf::from(root))?, &path)).await
}

/// Opens a reference in the operating system's default app. Only `references/<name>` of an open project, and never a
/// program, script, web page or SVG.
#[tauri::command]
pub async fn open_reference<R: tauri::Runtime>(app: tauri::AppHandle<R>, root: String, path: String) -> Result<(), ProjectError> {
    let file = blocking(move || project::reference_open_path(&project::require_project(&PathBuf::from(root))?, &path)).await?;
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| ProjectError::Io { message: e.to_string() })
}

/// Opens a link reference in the default browser. Only an `http` or `https` address (`checked_web_url`); the app never
/// fetches it and never opens it except when the author clicks it.
#[tauri::command]
pub async fn open_reference_url<R: tauri::Runtime>(app: tauri::AppHandle<R>, url: String) -> Result<(), ProjectError> {
    project::checked_web_url(&url)?;
    app.opener().open_url(&url, None::<&str>).map_err(|e| ProjectError::Io { message: e.to_string() })
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{project, raw, root, run};
    use super::*;

    #[test]
    fn a_file_is_imported_stat_read_in_ranges_and_trashed() {
        let (book, src) = (project(), tempfile::tempdir().unwrap());
        std::fs::write(src.path().join("Lighthouse history.pdf"), b"%PDF-1.4 hello world").unwrap();
        let picked = PickedPaths::default();
        picked.record(PickKind::Reference, &src.path().join("Lighthouse history.pdf")).unwrap();
        let got = import_picked(&picked, &root(&book), &src.path().join("Lighthouse history.pdf").to_string_lossy()).unwrap();
        assert_eq!(got.file, "references/Lighthouse-history.pdf");
        assert_eq!(got.title, "Lighthouse history");
        let stat = run(stat_reference(root(&book), got.file.clone())).unwrap();
        assert_eq!(stat.size, 20);
        assert_eq!(raw(run(read_reference(root(&book), got.file.clone(), 0, 8)).unwrap()), b"%PDF-1.4");
        assert_eq!(raw(run(read_reference(root(&book), got.file.clone(), 9, 100)).unwrap()), b"hello world");
        let trashed = run(trash_reference(root(&book), got.file.clone())).unwrap();
        assert!(trashed.starts_with(".cadabra/trash/"), "{trashed}");
        assert!(run(stat_reference(root(&book), got.file)).is_err());
    }

    #[test]
    fn reference_commands_refuse_a_folder_that_is_not_a_project_and_bad_input() {
        let (plain, book) = (tempfile::tempdir().unwrap(), project());
        let plain = plain.path().to_string_lossy().into_owned();
        assert!(import_picked(&PickedPaths::default(), &plain, "/nope.pdf").is_err());
        assert!(run(stat_reference(plain.clone(), "references/a.pdf".into())).is_err());
        assert!(run(read_reference(plain.clone(), "references/a.pdf".into(), 0, 1)).is_err());
        assert!(run(trash_reference(plain, "references/a.pdf".into())).is_err());
        assert!(run(stat_reference(root(&book), "assets/a.png".into())).is_err());
        assert!(run(read_reference(root(&book), "references/../cadabra.json".into(), 0, 1)).is_err());
    }

    #[test]
    fn a_file_that_was_not_picked_for_references_is_refused_even_when_it_is_a_fine_file() {
        let (book, src) = (project(), tempfile::tempdir().unwrap());
        let (notes, other) = (src.path().join("notes.txt"), src.path().join("other.txt"));
        std::fs::write(&notes, "x").unwrap();
        std::fs::write(&other, "x").unwrap();
        let picked = PickedPaths::default();
        picked.record(PickKind::Reference, &notes).unwrap();
        picked.record(PickKind::Image, &other).unwrap(); // picked, but for something else
        assert!(matches!(import_picked(&picked, &root(&book), &other.to_string_lossy()), Err(ProjectError::NotPicked { name }) if name == "other.txt"));
        assert!(matches!(import_picked(&picked, &root(&book), "/nonexistent/hosts"), Err(ProjectError::NotPicked { .. })));
        assert!(import_picked(&picked, &root(&book), &notes.to_string_lossy()).is_ok());
        assert!(!book.path().join("references/other.txt").exists());
    }
}

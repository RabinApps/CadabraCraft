//! Library commands: scanning a folder of books the author picked, and the stamp of a cover image.
use super::{PickKind, PickedPaths};
use crate::platform::blocking;
use crate::project::{self, AssetStat, LibraryScan, ProjectError};
use std::path::PathBuf;
use tauri::State;

/// `scan_library`: the folder must be one the author picked with `pick_library_folder`.
fn scan_picked(picked: &PickedPaths, root: &str) -> Result<LibraryScan, ProjectError> {
    project::scan_library(&picked.require(PickKind::Library, &PathBuf::from(root))?)
}

/// Lists the books (manifest fields only) in a folder the author picked as a library. Any other folder is refused.
#[tauri::command]
pub async fn scan_library(picked: State<'_, PickedPaths>, root: String) -> Result<LibraryScan, ProjectError> {
    blocking({ let picked = picked.inner().clone(); move || scan_picked(&picked, &root) }).await
}

/// Size and modification time of `assets/<image>`, for the cover thumbnail cache.
#[tauri::command]
pub async fn stat_asset(root: String, path: String) -> Result<AssetStat, ProjectError> {
    blocking(move || project::stat_asset(&project::require_project(&PathBuf::from(root))?, &path)).await
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{project, root, run};
    use super::*;

    #[test]
    fn only_a_folder_picked_as_a_library_is_scanned() {
        let (lib, other) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let book = lib.path().join("b");
        std::fs::create_dir(&book).unwrap();
        std::fs::write(book.join("cadabra.json"), r#"{"editions":[{"title":"B","author":"A"}]}"#).unwrap();
        let picked = PickedPaths::default();
        picked.record(PickKind::Library, lib.path()).unwrap();
        picked.record(PickKind::Folder, other.path()).unwrap(); // picked, but for a new book
        let scan = scan_picked(&picked, &lib.path().to_string_lossy()).unwrap();
        assert_eq!(scan.books.len(), 1);
        assert_eq!(scan_picked(&picked, &other.path().to_string_lossy()), Err(ProjectError::NotPicked { name: other.path().file_name().unwrap().to_string_lossy().into_owned() }));
        assert!(scan_picked(&picked, &book.to_string_lossy()).is_err(), "a child of a picked folder was not picked");
    }

    #[test]
    fn a_cover_stamp_needs_a_project() {
        let book = project();
        std::fs::create_dir(book.path().join("assets")).unwrap();
        std::fs::write(book.path().join("assets/c.png"), [1u8]).unwrap();
        assert_eq!(run(stat_asset(root(&book), "assets/c.png".into())).unwrap().size, 1);
        let plain = tempfile::tempdir().unwrap();
        assert!(run(stat_asset(plain.path().to_string_lossy().into_owned(), "assets/c.png".into())).is_err());
    }
}

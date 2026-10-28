//! Page snapshot commands (see `project/snapshots.rs`).
use crate::platform::blocking;
use crate::project::snapshots::{self, SnapshotEntry, StalePage};
use crate::project::{self, FileRead, ProjectError, WriteResult};
use std::path::PathBuf;

/// Earlier versions of a page, newest first (see `project/snapshots.rs`).
#[tauri::command]
pub async fn list_page_snapshots(root: String, path: String) -> Result<Vec<SnapshotEntry>, ProjectError> {
    blocking(move || snapshots::list_snapshots(&project::require_project(&PathBuf::from(root))?, &path)).await
}

#[tauri::command]
pub async fn read_page_snapshot(root: String, path: String, snapshot: String) -> Result<FileRead, ProjectError> {
    blocking(move || snapshots::read_snapshot(&project::require_project(&PathBuf::from(root))?, &path, &snapshot)).await
}

/// Puts a snapshot back as the page; the text it replaces is kept as a snapshot first.
#[tauri::command]
pub async fn restore_page_snapshot(root: String, path: String, snapshot: String) -> Result<WriteResult, ProjectError> {
    blocking(move || snapshots::restore_snapshot(&project::require_project(&PathBuf::from(root))?, &path, &snapshot)).await
}

/// Removes old snapshots beyond `keep` per page (never ones younger than 30 days). Returns how many were removed.
#[tauri::command]
pub async fn prune_page_snapshots(root: String, paths: Vec<String>, keep: usize) -> Result<u32, ProjectError> {
    blocking(move || snapshots::prune(&project::require_project(&PathBuf::from(root))?, &paths, keep, chrono::Utc::now())).await
}

/// Pages whose newest snapshot is newer than the page and differs from it.
#[tauri::command]
pub async fn find_stale_pages(root: String, paths: Vec<String>) -> Result<Vec<StalePage>, ProjectError> {
    blocking(move || snapshots::find_stale(&project::require_project(&PathBuf::from(root))?, &paths)).await
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{project, root, run};
    use super::*;

    const PAGE: &str = "manuscript/001-a.json";

    /// A page written twice, so the first text is kept as a snapshot.
    fn two_versions(book: &tempfile::TempDir) -> (String, String) {
        let first = run(crate::commands::write_project_file(root(book), PAGE.into(), "one".into(), None)).unwrap();
        run(crate::commands::write_project_file(root(book), PAGE.into(), "two".into(), Some(first.hash))).unwrap();
        let snaps = run(list_page_snapshots(root(book), PAGE.into())).unwrap();
        assert_eq!(snaps.len(), 1, "{snaps:?}");
        (snaps[0].path.clone(), "one".into())
    }

    #[test]
    fn snapshots_are_listed_read_restored_and_pruned() {
        let book = project();
        let (snap, text) = two_versions(&book);
        assert_eq!(run(read_page_snapshot(root(&book), PAGE.into(), snap.clone())).unwrap().contents, text);
        let restored = run(restore_page_snapshot(root(&book), PAGE.into(), snap)).unwrap();
        assert!(!restored.hash.is_empty());
        let page = crate::project::read_file(book.path(), PAGE).unwrap().unwrap();
        assert_eq!(page.contents, "one");
        assert_eq!(run(prune_page_snapshots(root(&book), vec![PAGE.into()], 50)).unwrap(), 0);
    }

    #[test]
    fn stale_pages_are_found_and_foreign_snapshots_refused() {
        let book = project();
        assert_eq!(run(find_stale_pages(root(&book), vec![PAGE.into()])).unwrap(), vec![]);
        assert!(run(read_page_snapshot(root(&book), PAGE.into(), "manuscript/other.json".into())).is_err());
        assert_eq!(run(find_stale_pages(root(&book), vec!["../x.json".into()])).unwrap(), vec![]);
    }

    #[test]
    fn snapshot_commands_refuse_a_folder_that_is_not_a_project() {
        let plain = tempfile::tempdir().unwrap();
        let r = plain.path().to_string_lossy().into_owned();
        assert!(run(list_page_snapshots(r.clone(), PAGE.into())).is_err());
        assert!(run(restore_page_snapshot(r.clone(), PAGE.into(), "x".into())).is_err());
        assert!(run(prune_page_snapshots(r, vec![], 1)).is_err());
    }
}

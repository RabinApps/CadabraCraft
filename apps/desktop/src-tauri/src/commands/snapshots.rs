//! Page snapshot commands (see `project/snapshots.rs`).
use crate::platform::blocking;
use crate::project::book_snapshots::{self, BookRestore, BookSnapshotEntry, BookSnapshotMade, Limits, PruneReport};
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

/// Whole-book snapshots, newest first (see `project/book_snapshots.rs`).
#[tauri::command]
pub async fn list_book_snapshots(root: String) -> Result<Vec<BookSnapshotEntry>, ProjectError> {
    blocking(move || book_snapshots::list_book_snapshots(&project::require_project(&PathBuf::from(root))?)).await
}

/// Takes a named snapshot of the whole book as it is on disk, then keeps to the limits (the author's Settings; a missing
/// or bad value is the default, and values are clamped, see `Limits::from_args`). Says how many snapshots moved to the
/// trash.
#[tauri::command]
pub async fn create_book_snapshot(root: String, name: String, max_count: Option<f64>, max_mb: Option<f64>) -> Result<BookSnapshotMade, ProjectError> {
    let limits = Limits::from_args(max_count, max_mb);
    blocking(move || book_snapshots::create_book_snapshot_with(&project::require_project(&PathBuf::from(root))?, &name, chrono::Utc::now(), limits)).await
}

/// Keeps the book's snapshots to the limits (called when a book is opened): the oldest automatic ones, then named ones,
/// move to the trash; pinned ones stay unless they alone exceed the hard ceiling, and are then named in the result.
#[tauri::command]
pub async fn prune_book_snapshots(root: String, max_count: Option<f64>, max_mb: Option<f64>) -> Result<PruneReport, ProjectError> {
    let limits = Limits::from_args(max_count, max_mb);
    blocking(move || Ok(book_snapshots::prune_to_limits(&project::require_project(&PathBuf::from(root))?, limits, chrono::Utc::now()))).await
}

/// Gives a book snapshot a new name (an automatic one becomes a named one).
#[tauri::command]
pub async fn rename_book_snapshot(root: String, snapshot: String, name: String) -> Result<BookSnapshotEntry, ProjectError> {
    blocking(move || book_snapshots::rename_book_snapshot(&project::require_project(&PathBuf::from(root))?, &snapshot, &name)).await
}

/// Pins or unpins a book snapshot; a pinned one is not pruned for the count or byte limit.
#[tauri::command]
pub async fn pin_book_snapshot(root: String, snapshot: String, pinned: bool) -> Result<BookSnapshotEntry, ProjectError> {
    blocking(move || book_snapshots::pin_book_snapshot(&project::require_project(&PathBuf::from(root))?, &snapshot, pinned)).await
}

/// The text of one page as a book snapshot holds it.
#[tauri::command]
pub async fn read_book_snapshot_page(root: String, snapshot: String, path: String) -> Result<FileRead, ProjectError> {
    blocking(move || book_snapshots::read_book_snapshot_page(&project::require_project(&PathBuf::from(root))?, &snapshot, &path)).await
}

/// Puts the whole book back; an automatic snapshot of the book as it is comes first.
#[tauri::command]
pub async fn restore_book_snapshot(root: String, snapshot: String) -> Result<BookRestore, ProjectError> {
    blocking(move || book_snapshots::restore_book_snapshot(&project::require_project(&PathBuf::from(root))?, &snapshot, chrono::Utc::now())).await
}

/// Puts one page back from a book snapshot; the text it replaces is kept as a snapshot first.
#[tauri::command]
pub async fn restore_page_from_book_snapshot(root: String, snapshot: String, path: String) -> Result<WriteResult, ProjectError> {
    blocking(move || book_snapshots::restore_page_from_book(&project::require_project(&PathBuf::from(root))?, &snapshot, &path)).await
}

/// Deletes one book snapshot (at the author's request).
#[tauri::command]
pub async fn delete_book_snapshot(root: String, snapshot: String) -> Result<(), ProjectError> {
    blocking(move || book_snapshots::delete_book_snapshot(&project::require_project(&PathBuf::from(root))?, &snapshot)).await
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

    #[test]
    fn book_snapshots_are_taken_listed_restored_and_deleted() {
        let book = project();
        run(crate::commands::write_project_file(root(&book), PAGE.into(), "one".into(), None)).unwrap();
        let made = run(create_book_snapshot(root(&book), "v1".into(), None, None)).unwrap().entry;
        assert_eq!(run(list_book_snapshots(root(&book))).unwrap(), vec![made.clone()]);
        run(crate::commands::write_project_file(root(&book), PAGE.into(), "two".into(), None)).unwrap();
        assert_eq!(run(read_book_snapshot_page(root(&book), made.path.clone(), PAGE.into())).unwrap().contents, "one");
        run(restore_page_from_book_snapshot(root(&book), made.path.clone(), PAGE.into())).unwrap();
        run(crate::commands::write_project_file(root(&book), PAGE.into(), "three".into(), None)).unwrap();
        let r = run(restore_book_snapshot(root(&book), made.path.clone())).unwrap();
        assert_eq!(r.written, vec![PAGE.to_string()]);
        run(delete_book_snapshot(root(&book), made.path)).unwrap();
        assert_eq!(run(list_book_snapshots(root(&book))).unwrap().len(), 1);
    }

    #[test]
    fn book_snapshot_commands_refuse_a_folder_that_is_not_a_project() {
        let plain = tempfile::tempdir().unwrap();
        let r = plain.path().to_string_lossy().into_owned();
        assert!(run(list_book_snapshots(r.clone())).is_err());
        assert!(run(create_book_snapshot(r.clone(), "x".into(), None, None)).is_err());
        assert!(run(read_book_snapshot_page(r.clone(), "s".into(), "p".into())).is_err());
        assert!(run(restore_book_snapshot(r.clone(), "s".into())).is_err());
        assert!(run(restore_page_from_book_snapshot(r.clone(), "s".into(), "p".into())).is_err());
        assert!(run(delete_book_snapshot(r.clone(), "s".into())).is_err());
        assert!(run(prune_book_snapshots(r.clone(), None, None)).is_err());
        assert!(run(rename_book_snapshot(r.clone(), "s".into(), "n".into())).is_err());
        assert!(run(pin_book_snapshot(r, "s".into(), true)).is_err());
    }

    #[test]
    fn limits_come_from_the_caller_and_the_result_counts_what_moved() {
        let book = project();
        run(crate::commands::write_project_file(root(&book), PAGE.into(), "one".into(), None)).unwrap();
        // Bad limits are clamped to the minimum of 5, so the sixth snapshot moves the oldest to the trash.
        let made: Vec<_> = (0..6).map(|i| run(create_book_snapshot(root(&book), format!("s{i}"), Some(1.0), Some(1.0))).unwrap()).collect();
        assert!(made[..5].iter().all(|m| m.pruned.moved == 0));
        let made = &made[5];
        assert_eq!(made.pruned.moved, 1, "the oldest moved to the trash");
        let names: Vec<_> = run(list_book_snapshots(root(&book))).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["s5", "s4", "s3", "s2", "s1"]);
        assert_eq!(made.pruned.pinned_moved, Vec::<String>::new());
        // Pruning on open with the same bad limits has nothing left to move; a missing limit is the default.
        let again = run(prune_book_snapshots(root(&book), Some(-3.0), None)).unwrap();
        assert_eq!(again.moved, 0);
    }

    #[test]
    fn a_snapshot_is_renamed_and_pinned_through_the_commands() {
        let book = project();
        let made = run(create_book_snapshot(root(&book), "v1".into(), None, None)).unwrap().entry;
        let renamed = run(rename_book_snapshot(root(&book), made.path.clone(), " Draft two ".into())).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.pinned), ("Draft two", false));
        let pinned = run(pin_book_snapshot(root(&book), made.path.clone(), true)).unwrap();
        assert!(pinned.pinned);
        assert_eq!(run(list_book_snapshots(root(&book))).unwrap(), vec![pinned]);
        assert!(run(rename_book_snapshot(root(&book), made.path.clone(), "  ".into())).is_err());
        assert!(run(pin_book_snapshot(root(&book), "cadabra.json".into(), true)).is_err());
    }
}

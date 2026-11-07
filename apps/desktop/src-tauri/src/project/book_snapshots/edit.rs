//! Changing one snapshot in place: its name, and whether it is pinned. Both rewrite the whole file (the name and the
//! flag are in its head) as temp file and rename, under the lock every other change to the snapshot files takes.
use super::file::{BookFile, Summary};
use super::{atomic_write, entry_of, files_lock, parse_name, require_listed, resolve, snapshot_too_large, valid_name, BookSnapshotEntry, Result};
use super::{ProjectError, MAX_SNAPSHOT_BYTES, SNAPSHOTS_DIR};
use std::fs;
use std::path::Path;

/// Gives a listed snapshot a new name. An automatic snapshot ("Before restoring ...") becomes a named one: the author
/// has claimed it. The texts, the pin and the file name are unchanged. A file already at the size cap that the longer
/// name would push over it is refused with `too_large` and left as it was.
pub fn rename_book_snapshot(root: &Path, snapshot: &str, name: &str) -> Result<BookSnapshotEntry> {
    let name = valid_name(name)?;
    rewrite(root, snapshot, |book| {
        book.name = name;
        book.automatic = false;
    })
}

/// Pins or unpins a listed snapshot. A pinned snapshot is never pruned for the count or the byte limit (see
/// `prune.rs`).
pub fn pin_book_snapshot(root: &Path, snapshot: &str, pinned: bool) -> Result<BookSnapshotEntry> {
    rewrite(root, snapshot, |book| book.pinned = pinned)
}

fn rewrite(root: &Path, snapshot: &str, change: impl FnOnce(&mut BookFile)) -> Result<BookSnapshotEntry> {
    // Listing may upgrade an old file (it takes the lock itself), so it runs before the lock is held here.
    require_listed(root, snapshot)?;
    let file = resolve(root, snapshot)?;
    let _held = files_lock();
    let cannot = || ProjectError::CannotRestore { path: snapshot.to_string() };
    let meta = fs::metadata(&file).map_err(|_| cannot())?;
    if meta.len() > MAX_SNAPSHOT_BYTES {
        return Err(snapshot_too_large());
    }
    let mut book: BookFile = serde_json::from_slice(&fs::read(&file).map_err(|_| cannot())?).map_err(|_| cannot())?;
    change(&mut book);
    if book.summary.is_none() {
        book.summary = Some(Summary { pages: book.pages.keys().cloned().collect(), assets: book.assets.len() });
    }
    let bytes = serde_json::to_vec(&book).map_err(|e| ProjectError::Io { message: e.to_string() })?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(snapshot_too_large());
    }
    atomic_write(&file, &bytes)?;
    let name = snapshot.strip_prefix(SNAPSHOTS_DIR).and_then(|r| r.strip_prefix('/')).unwrap_or_default();
    let at = parse_name(name).map(|(stamp, _)| stamp).ok_or_else(cannot)?;
    Ok(entry_of(snapshot.to_string(), at, book, bytes.len() as u64))
}

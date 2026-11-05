//! Whole-book snapshots: the manifest, every page and the list of image files, in one file under
//! `.cadabra/snapshots/<YYYYMMDD-HHMM>[~N].json`. Like the per-page versions in `snapshots.rs` they belong to this computer
//! (`.cadabra` is not synced) and hold no absolute paths. Named ones are taken by the author; restoring a book first takes an
//! automatic one ("Before restoring ...") so a restore can itself be undone.
//!
//! Image files are listed, not copied: the app never deletes or rewrites an asset, so the list is enough to tell the author
//! which images a restored chapter needs and are gone.
//!
//! Limits: a snapshot file is at most `MAX_SNAPSHOT_BYTES` (the read cap, so one that can be created can always be loaded
//! and restored; a larger book is refused with `too_large` instead). At most `MAX_SNAPSHOTS` are kept, within
//! `MAX_TOTAL_BYTES` together: after a new one is taken the oldest beyond that move to `.cadabra/trash/` as
//! `<stamp>-snapshot__<name>.json`. Automatic ones go first (oldest first); the author's named ones only when the limits
//! are still exceeded once every automatic one is gone. The app never deletes them, but it does not list or restore
//! trashed snapshots either: the file is intact there and can be copied back into `.cadabra/snapshots/` by hand.
//! Listing reads only the start of each file (a `summary` field written before the texts), not the whole file. A file
//! from before `summary` existed is read through once and rewritten with one (same name, same content).
use self::file::{read_head_slow, scan_automatic, BookFile, Summary};
use super::fsio::move_to_free_copy_name;
use super::pages::MAX_READ_BYTES;
use super::snapshots::{is_snapshotable, SnapshotMode};
use super::{atomic_write, free_copy_name, hash_bytes, read_file, resolve, trash_file, write_file_with, FileRead, ProjectError, Result, WriteResult, MANIFEST};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub const SNAPSHOTS_DIR: &str = ".cadabra/snapshots";
/// Longest snapshot name, in characters.
pub const MAX_NAME_CHARS: usize = 100;
/// Largest snapshot file, in bytes: the same as the cap on reading any project file, so every snapshot that is created
/// can be loaded again. A larger book is refused rather than half kept.
pub const MAX_SNAPSHOT_BYTES: u64 = MAX_READ_BYTES;
/// Most snapshots kept; older ones move to the project trash.
pub const MAX_SNAPSHOTS: usize = 50;
/// Most bytes all snapshots may take together; older ones move to the project trash.
pub const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
mod file;

/// How much of a snapshot file is read to list it.
const HEAD_BYTES: u64 = 256 * 1024;
const PAGE_DIRS: [&str; 3] = ["manuscript", "front-matter", "back-matter"];
const FORMAT: u32 = 1;

/// Guards every change to the snapshot files (naming and writing a new one, the upgrade below, moving one to the trash,
/// deleting one), so an upgrade cannot bring back a file that was just deleted or moved.
static FILES: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn files_lock() -> std::sync::MutexGuard<'static, ()> {
    FILES.lock().unwrap_or_else(|e| e.into_inner())
}

/// Rewrites a snapshot that has no `summary` in its head with one, so later listings do not read it through. Best effort:
/// a file over the size cap, one that changed or went away meanwhile, or any failure leaves it exactly as it was. The
/// name, the version, the texts and the lists are unchanged.
fn upgrade_legacy(file: &Path) {
    let Ok(before) = fs::metadata(file) else { return };
    if before.len() > MAX_SNAPSHOT_BYTES {
        return;
    }
    let Ok(text) = fs::read(file) else { return };
    let Ok(mut book) = serde_json::from_slice::<BookFile>(&text) else { return };
    if book.summary.is_some() {
        return;
    }
    book.summary = Some(Summary { pages: book.pages.keys().cloned().collect(), assets: book.assets.len() });
    let Ok(bytes) = serde_json::to_vec(&book) else { return };
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return;
    }
    let _held = files_lock();
    if fs::metadata(file).is_ok_and(|now| now.len() == before.len() && now.modified().ok() == before.modified().ok()) {
        let _ = atomic_write(file, &bytes);
    }
}

/// One whole-book snapshot, as listed.
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct BookSnapshotEntry {
    /// Project-relative path of the snapshot file.
    pub path: String,
    /// `YYYYMMDD-HHMM` (UTC) it was taken at.
    pub at: String,
    pub name: String,
    /// Taken by the app (before a restore), not named by the author.
    pub automatic: bool,
    /// Project-relative paths of the pages it holds.
    pub pages: Vec<String>,
    /// How many image files it lists.
    pub assets: usize,
    /// Size of the snapshot file.
    pub bytes: u64,
}

/// What a whole-book restore did.
#[derive(Serialize, Debug, PartialEq)]
pub struct BookRestore {
    /// The automatic snapshot of the book as it was just before.
    pub safety: String,
    /// Pages whose text was put back (those already equal are left alone).
    pub written: Vec<String>,
    /// Pages that were not in the snapshot; they are in `.cadabra/trash` now.
    pub trashed: Vec<String>,
    /// Image files the snapshot lists that are no longer in `assets/`.
    pub missing_assets: Vec<String>,
}

/// `manuscript|front-matter|back-matter/<name>.json`, optionally one language folder deeper.
fn is_book_page(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    (2..=3).contains(&parts.len()) && PAGE_DIRS.contains(&parts[0]) && parts[1..].iter().all(|p| !p.is_empty()) && parts[parts.len() - 1].ends_with(".json") && !rel.contains(".conflict-")
}

fn file_names(root: &Path, dir: &str, want_dirs: bool) -> Result<Vec<String>> {
    let read = match fs::read_dir(resolve(root, dir)?) {
        Ok(r) => r,
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut out = vec![];
    for item in read {
        let item = item?;
        let t = item.file_type()?; // a link is neither: it is never followed
        if (want_dirs && t.is_dir()) || (!want_dirs && t.is_file()) {
            if let Some(name) = item.file_name().to_str() {
                out.push(name.to_string());
            }
        }
    }
    out.sort();
    Ok(out)
}

/// The pages on disk now.
fn current_pages(root: &Path) -> Result<Vec<String>> {
    let mut out = vec![];
    for dir in PAGE_DIRS {
        for file in file_names(root, dir, false)? {
            out.push(format!("{dir}/{file}"));
        }
        for lang in file_names(root, dir, true)? {
            for file in file_names(root, &format!("{dir}/{lang}"), false)? {
                out.push(format!("{dir}/{lang}/{file}"));
            }
        }
    }
    out.retain(|p| is_book_page(p));
    Ok(out)
}

fn stamp_of(t: DateTime<Utc>) -> String {
    t.format("%Y%m%d-%H%M").to_string()
}

/// `(stamp, n)` when `name` is `<stamp>.json` (n = 1) or `<stamp>~<n>.json`.
fn parse_name(name: &str) -> Option<(String, u32)> {
    let stem = name.strip_suffix(".json")?;
    let (stamp, n) = match stem.split_once('~') {
        Some((s, n)) => (s, n.parse::<u32>().ok().filter(|n| *n >= 2)?),
        None => (stem, 1),
    };
    let b = stamp.as_bytes();
    let ok = b.len() == 13 && b[..8].iter().all(u8::is_ascii_digit) && b[8] == b'-' && b[9..].iter().all(u8::is_ascii_digit);
    ok.then(|| (stamp.to_string(), n))
}

/// The book snapshots, newest first. A file that is not a snapshot of this format is skipped, never an error.
pub fn list_book_snapshots(root: &Path) -> Result<Vec<BookSnapshotEntry>> {
    list_with(root, HEAD_BYTES)
}

fn list_with(root: &Path, head_bytes: u64) -> Result<Vec<BookSnapshotEntry>> {
    let mut found = vec![];
    for name in file_names(root, SNAPSHOTS_DIR, false)? {
        let Some(key) = parse_name(&name) else { continue };
        let path = format!("{SNAPSHOTS_DIR}/{name}");
        let file = resolve(root, &path)?;
        let Some((head, slow)) = read_head_slow(&file, head_bytes) else { continue };
        if head.version != FORMAT {
            continue;
        }
        if slow && head_bytes == HEAD_BYTES {
            upgrade_legacy(&file);
        }
        let Ok(meta) = fs::metadata(&file) else { continue };
        found.push((key.clone(), BookSnapshotEntry { path, at: key.0, name: head.name, automatic: head.automatic, pages: head.summary.pages, assets: head.summary.assets, bytes: meta.len() }));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(found.into_iter().map(|(_, e)| e).collect())
}

fn valid_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(ProjectError::InvalidFileName);
    }
    Ok(name.to_string())
}

/// Takes a snapshot of the whole book as it is on disk now and returns its entry.
pub fn create_book_snapshot(root: &Path, name: &str, now: DateTime<Utc>) -> Result<BookSnapshotEntry> {
    create(root, &valid_name(name)?, false, now)
}

fn create(root: &Path, name: &str, automatic: bool, now: DateTime<Utc>) -> Result<BookSnapshotEntry> {
    let manifest = read_file(root, MANIFEST)?.ok_or_else(|| ProjectError::NotFound { path: MANIFEST.to_string() })?.contents;
    let mut total = manifest.len() as u64;
    let mut pages = BTreeMap::new();
    for rel in current_pages(root)? {
        let Some(FileRead { contents, .. }) = read_file(root, &rel)? else { continue };
        total += contents.len() as u64;
        if total > MAX_SNAPSHOT_BYTES {
            return Err(snapshot_too_large());
        }
        pages.insert(rel, contents);
    }
    let assets: Vec<String> = file_names(root, "assets", false)?.into_iter().map(|f| format!("assets/{f}")).collect();
    let summary = Summary { pages: pages.keys().cloned().collect(), assets: assets.len() };
    let file = BookFile { version: FORMAT, name: name.to_string(), automatic, summary: Some(summary), manifest, pages, assets };
    let bytes = serde_json::to_vec(&file).map_err(|e| ProjectError::Io { message: e.to_string() })?;
    // The file (not just the text) must stay within what loading accepts, or the snapshot could never be restored.
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(snapshot_too_large());
    }
    // A name already taken (two snapshots in one minute) gets `~2`, never replaces the first.
    // The free name is picked and the file written under one lock: the write replaces, so two snapshots taken at once
    // (a double click, an automatic one during a restore) would otherwise pick the same name and one would be lost.
    let to = {
        let _held = files_lock();
        let to = free_copy_name(root, &format!("{SNAPSHOTS_DIR}/{}.json", stamp_of(now)))?;
        atomic_write(&resolve(root, &to)?, &bytes)?;
        to
    };
    prune_book_snapshots(root, &to, MAX_SNAPSHOTS, MAX_TOTAL_BYTES, now);
    Ok(BookSnapshotEntry { path: to, at: stamp_of(now), name: file.name, automatic, pages: file.pages.into_keys().collect(), assets: file.assets.len(), bytes: bytes.len() as u64 })
}

fn snapshot_too_large() -> ProjectError {
    ProjectError::TooLarge { path: SNAPSHOTS_DIR.to_string(), max_mb: MAX_SNAPSHOT_BYTES / 1024 / 1024 }
}

/// Moves snapshots to `.cadabra/trash/` until at most `max_count` remain within `max_bytes` together: automatic ones
/// first (oldest first), then, only if the limits are still exceeded, the author's named ones (oldest first). The
/// snapshot at `keep` (the one just taken) is never moved, and nothing is deleted. Best effort: a snapshot that cannot be
/// moved stays where it is, and the new snapshot is still reported. Returns the paths moved.
///
/// Uses only file names and sizes, plus the first bytes of the files that are candidates (to see whether each is
/// automatic): never the summary or the texts, so a legacy file is not streamed through here. A file that is not a
/// snapshot of this format is neither counted nor moved.
pub(crate) fn prune_book_snapshots(root: &Path, keep: &str, max_count: usize, max_bytes: u64, now: DateTime<Utc>) -> Vec<String> {
    let Ok(names) = file_names(root, SNAPSHOTS_DIR, false) else { return vec![] };
    let mut files: Vec<((String, u32), String, u64)> = vec![];
    for name in names {
        let Some(key) = parse_name(&name) else { continue };
        let path = format!("{SNAPSHOTS_DIR}/{name}");
        let Ok(meta) = resolve(root, &path).and_then(|f| fs::metadata(f).map_err(Into::into)) else { continue };
        files.push((key, path, meta.len()));
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let (mut count, mut total) = (files.len(), files.iter().map(|f| f.2).sum::<u64>());
    let mut moved = vec![];
    let mut pending: Vec<&((String, u32), String, u64)> = files.iter().filter(|f| f.1 != keep).collect();
    for want_automatic in [true, false] {
        let mut next = vec![];
        for f in pending {
            if count <= max_count && total <= max_bytes {
                return moved;
            }
            let Ok(file) = resolve(root, &f.1) else { continue };
            match scan_automatic(&file, HEAD_BYTES) {
                None => (count, total) = (count - 1, total - f.2), // not a snapshot: not counted, never moved
                Some(auto) if auto != want_automatic => next.push(f),
                Some(_) => {
                    let _held = files_lock();
                    let want = format!(".cadabra/trash/{}-snapshot__{}", stamp_of(now), f.1.rsplit('/').next().unwrap_or_default());
                    if move_to_free_copy_name(root, &file, &want, &f.1).is_ok() {
                        (count, total) = (count - 1, total - f.2);
                        moved.push(f.1.clone());
                    }
                }
            }
        }
        pending = next;
    }
    moved
}

/// The snapshot path must be one of the listed snapshots, so a caller cannot make this read or delete any other file.
fn require_listed(root: &Path, snapshot: &str) -> Result<()> {
    let direct = snapshot.strip_prefix(SNAPSHOTS_DIR).and_then(|r| r.strip_prefix('/')).is_some_and(|name| !name.contains('/') && parse_name(name).is_some());
    if direct && list_book_snapshots(root)?.iter().any(|e| e.path == snapshot) {
        Ok(())
    } else {
        Err(ProjectError::CannotRestore { path: snapshot.to_string() })
    }
}

fn load(root: &Path, snapshot: &str) -> Result<BookFile> {
    require_listed(root, snapshot)?;
    let read = read_file(root, snapshot)?.ok_or_else(|| ProjectError::NotFound { path: snapshot.to_string() })?;
    serde_json::from_str(&read.contents).map_err(|_| ProjectError::CannotRestore { path: snapshot.to_string() })
}

/// The text of one page as the snapshot holds it (for comparing before a restore).
pub fn read_book_snapshot_page(root: &Path, snapshot: &str, rel: &str) -> Result<FileRead> {
    let file = load(root, snapshot)?;
    let text = file.pages.get(rel).ok_or_else(|| ProjectError::NotFound { path: rel.to_string() })?;
    Ok(FileRead { hash: hash_bytes(text.as_bytes()), contents: text.clone() })
}

fn safety_name(of: &str) -> String {
    let prefix = "Before restoring ";
    let room = MAX_NAME_CHARS - prefix.chars().count();
    format!("{prefix}{}", of.chars().take(room).collect::<String>())
}

/// Puts one page back from a book snapshot. The text it replaces is kept as that page's own snapshot first (as for any
/// restore), so this too can be undone from the page's History.
pub fn restore_page_from_book(root: &Path, snapshot: &str, rel: &str) -> Result<WriteResult> {
    if !is_book_page(rel) {
        return Err(ProjectError::CannotRestore { path: rel.to_string() });
    }
    let file = load(root, snapshot)?;
    let text = file.pages.get(rel).ok_or_else(|| ProjectError::NotFound { path: rel.to_string() })?;
    // Pages one folder deeper (translations) have no per-page snapshots, so a whole-book copy is kept for them.
    if !is_snapshotable(rel) {
        create(root, &safety_name(&file.name), true, Utc::now())?;
    }
    write_file_with(root, rel, text, None, SnapshotMode::Always)
}

/// Puts the whole book back as the snapshot has it. An automatic snapshot of the book as it is comes first. Pages are
/// written, then the manifest, then pages the snapshot does not have go to the trash (never deleted). Images are not
/// touched; the ones the snapshot lists that are gone are reported.
pub fn restore_book_snapshot(root: &Path, snapshot: &str, now: DateTime<Utc>) -> Result<BookRestore> {
    let file = load(root, snapshot)?;
    if let Some(bad) = file.pages.keys().find(|p| !is_book_page(p)) {
        return Err(ProjectError::CannotRestore { path: bad.clone() });
    }
    let safety = create(root, &safety_name(&file.name), true, now)?.path;
    let mut written = vec![];
    for (rel, text) in &file.pages {
        if read_file(root, rel)?.is_some_and(|cur| cur.contents == *text) {
            continue;
        }
        write_file_with(root, rel, text, None, SnapshotMode::Always)?;
        written.push(rel.clone());
    }
    if read_file(root, MANIFEST)?.is_none_or(|cur| cur.contents != file.manifest) {
        write_file_with(root, MANIFEST, &file.manifest, None, SnapshotMode::Always)?;
    }
    let mut trashed = vec![];
    for rel in current_pages(root)? {
        if !file.pages.contains_key(&rel) {
            trash_file(root, &rel)?;
            trashed.push(rel);
        }
    }
    let have = file_names(root, "assets", false)?;
    let missing_assets = file.assets.iter().filter(|a| !have.iter().any(|h| format!("assets/{h}") == **a)).cloned().collect();
    Ok(BookRestore { safety, written, trashed, missing_assets })
}

/// Deletes one snapshot file (only ever one under `.cadabra/snapshots` that is listed), at the author's request.
pub fn delete_book_snapshot(root: &Path, snapshot: &str) -> Result<()> {
    require_listed(root, snapshot)?;
    let _held = files_lock();
    fs::remove_file(resolve(root, snapshot)?)?;
    Ok(())
}

#[cfg(test)]
mod tests;

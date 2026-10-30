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
//! `MAX_TOTAL_BYTES` together: after a new one is taken the oldest beyond that move to `.cadabra/trash/` (never deleted).
//! Listing reads only the start of each file (a `summary` field written before the texts), not the whole file.
use super::fsio::move_to_free_copy_name;
use super::pages::MAX_READ_BYTES;
use super::snapshots::{is_snapshotable, SnapshotMode};
use super::{atomic_write, free_copy_name, hash_bytes, read_file, resolve, trash_file, write_file_with, FileRead, ProjectError, Result, WriteResult, MANIFEST};
use chrono::{DateTime, Utc};
use serde::de::{self, IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
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
/// How much of a snapshot file is read to list it.
const HEAD_BYTES: u64 = 256 * 1024;
const PAGE_DIRS: [&str; 3] = ["manuscript", "front-matter", "back-matter"];
const FORMAT: u32 = 1;

/// What listing needs, stored before the (large) texts so it can be read from the start of the file.
#[derive(Serialize, Deserialize)]
struct Summary {
    pages: Vec<String>,
    assets: usize,
}

/// What is stored. `pages` maps a project-relative path to the file's text. Files written before `summary` existed
/// lack it and are listed by reading them through once.
#[derive(Serialize, Deserialize)]
struct BookFile {
    version: u32,
    name: String,
    automatic: bool,
    #[serde(default)]
    summary: Option<Summary>,
    manifest: String,
    pages: BTreeMap<String, String>,
    assets: Vec<String>,
}

/// The same file read without its texts (streamed, never held whole), for listing files that have no `summary` or whose
/// summary is beyond the first `HEAD_BYTES`.
#[derive(Deserialize)]
struct BookHead {
    version: u32,
    name: String,
    automatic: bool,
    pages: BTreeMap<String, IgnoredAny>,
    assets: Vec<String>,
}

/// The fields listing needs, from the start of a file.
struct Head {
    version: u32,
    name: String,
    automatic: bool,
    summary: Summary,
}

/// Reads fields up to `summary` and then stops by failing on purpose (`deserialize_map` would otherwise insist on
/// reading the rest of the file); the result is left in the cell.
struct Scan<'a>(&'a RefCell<Option<Head>>);

impl<'de> Visitor<'de> for Scan<'_> {
    type Value = ();

    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("a snapshot object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<(), A::Error> {
        let (mut version, mut name, mut automatic) = (None, None, None);
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "version" => version = Some(map.next_value::<u32>()?),
                "name" => name = Some(map.next_value::<String>()?),
                "automatic" => automatic = Some(map.next_value::<bool>()?),
                "summary" => {
                    let summary = map.next_value::<Summary>()?;
                    if let (Some(version), Some(name), Some(automatic)) = (version, name, automatic) {
                        *self.0.borrow_mut() = Some(Head { version, name, automatic, summary });
                    }
                    return Err(de::Error::custom("head complete"));
                }
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(())
    }
}

/// The head of the snapshot at `path` from its first `limit` bytes; None when the file has no summary in them.
fn scan_head(path: &Path, limit: u64) -> Option<Head> {
    let mut prefix = vec![];
    fs::File::open(path).ok()?.take(limit).read_to_end(&mut prefix).ok()?;
    let found = RefCell::new(None);
    let _ = serde_json::Deserializer::from_slice(&prefix).deserialize_map(Scan(&found));
    found.into_inner()
}

/// The head of the snapshot at `path`: the first `limit` bytes when they hold the summary, else the whole file streamed
/// through the head fields (constant memory, whatever its size).
fn read_head(path: &Path, limit: u64) -> Option<Head> {
    if let Some(head) = scan_head(path, limit) {
        return Some(head);
    }
    let file = fs::File::open(path).ok()?;
    let head: BookHead = serde_json::from_reader(std::io::BufReader::new(file)).ok()?;
    Some(Head { version: head.version, name: head.name, automatic: head.automatic, summary: Summary { pages: head.pages.into_keys().collect(), assets: head.assets.len() } })
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
        let Some(head) = read_head(&file, head_bytes) else { continue };
        if head.version != FORMAT {
            continue;
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
    let to = free_copy_name(root, &format!("{SNAPSHOTS_DIR}/{}.json", stamp_of(now)))?;
    atomic_write(&resolve(root, &to)?, &bytes)?;
    prune_book_snapshots(root, &to, MAX_SNAPSHOTS, MAX_TOTAL_BYTES, now);
    Ok(BookSnapshotEntry { path: to, at: stamp_of(now), name: file.name, automatic, pages: file.pages.into_keys().collect(), assets: file.assets.len(), bytes: bytes.len() as u64 })
}

fn snapshot_too_large() -> ProjectError {
    ProjectError::TooLarge { path: SNAPSHOTS_DIR.to_string(), max_mb: MAX_SNAPSHOT_BYTES / 1024 / 1024 }
}

/// Moves the oldest snapshots to `.cadabra/trash/` until at most `max_count` remain within `max_bytes` together. The
/// snapshot at `keep` (the one just taken) is never moved, and nothing is deleted. Best effort: a snapshot that cannot be
/// moved stays where it is, and the new snapshot is still reported. Returns the paths moved.
pub(crate) fn prune_book_snapshots(root: &Path, keep: &str, max_count: usize, max_bytes: u64, now: DateTime<Utc>) -> Vec<String> {
    let Ok(listed) = list_book_snapshots(root) else { return vec![] };
    let (mut count, mut total) = (listed.len(), listed.iter().map(|e| e.bytes).sum::<u64>());
    let mut moved = vec![];
    for e in listed.iter().rev().filter(|e| e.path != keep) {
        if count <= max_count && total <= max_bytes {
            break;
        }
        let want = format!(".cadabra/trash/{}-snapshot__{}", stamp_of(now), e.path.rsplit('/').next().unwrap_or_default());
        let from = resolve(root, &e.path);
        if from.is_ok_and(|from| move_to_free_copy_name(root, &from, &want, &e.path).is_ok()) {
            (count, total) = (count - 1, total - e.bytes);
            moved.push(e.path.clone());
        }
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
    fs::remove_file(resolve(root, snapshot)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::write_file;

    fn at(s: &str) -> DateTime<Utc> {
        chrono::NaiveDateTime::parse_from_str(s, "%Y%m%d-%H%M").unwrap().and_utc()
    }

    fn put(d: &Path, rel: &str, text: &str) {
        let p = d.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    fn book() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), "cadabra.json", "{\"v\":1}");
        put(d.path(), "manuscript/001-a.json", "A1");
        put(d.path(), "manuscript/002-b.json", "B1");
        put(d.path(), "manuscript/fr/001-a.json", "FR1");
        put(d.path(), "front-matter/01-x.json", "X1");
        put(d.path(), "manuscript/001-a.conflict-20261027-1000.json", "conflict");
        put(d.path(), "assets/pic.png", "png");
        d
    }

    fn read(d: &Path, rel: &str) -> String {
        fs::read_to_string(d.join(rel)).unwrap()
    }

    #[test]
    fn a_snapshot_holds_the_manifest_pages_and_asset_names_and_nothing_absolute() {
        let d = book();
        let e = create_book_snapshot(d.path(), "  Before the rewrite ", at("20261027-1000")).unwrap();
        assert_eq!(e.path, ".cadabra/snapshots/20261027-1000.json");
        assert_eq!((e.name.as_str(), e.automatic, e.assets), ("Before the rewrite", false, 1));
        assert_eq!(e.pages, ["front-matter/01-x.json", "manuscript/001-a.json", "manuscript/002-b.json", "manuscript/fr/001-a.json"], "conflict copies are not pages");
        let raw = read(d.path(), &e.path);
        assert!(raw.contains("\"assets/pic.png\"") && !raw.contains(d.path().to_str().unwrap()), "{raw}");
        assert_eq!(list_book_snapshots(d.path()).unwrap(), vec![e]);
    }

    #[test]
    fn snapshots_in_one_minute_never_replace_each_other_and_list_newest_first() {
        let d = book();
        let a = create_book_snapshot(d.path(), "a", at("20261027-1000")).unwrap();
        let b = create_book_snapshot(d.path(), "b", at("20261027-1000")).unwrap();
        let c = create_book_snapshot(d.path(), "c", at("20261026-0900")).unwrap();
        assert_eq!(b.path, ".cadabra/snapshots/20261027-1000~2.json");
        assert_eq!((b.at.as_str(), c.path.as_str()), ("20261027-1000", ".cadabra/snapshots/20261026-0900.json"));
        let names: Vec<_> = list_book_snapshots(d.path()).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["b", "a", "c"]);
        assert!(read(d.path(), &a.path).contains("\"name\":\"a\""));
    }

    #[test]
    fn names_are_checked_and_foreign_files_are_skipped() {
        let d = book();
        for bad in ["", "   ", "tab\there", &"x".repeat(101)] {
            assert_eq!(create_book_snapshot(d.path(), bad, at("20261027-1000")).unwrap_err(), ProjectError::InvalidFileName, "{bad:?}");
        }
        create_book_snapshot(d.path(), &"é".repeat(100), at("20261027-1000")).unwrap();
        let s = d.path().join(SNAPSHOTS_DIR);
        fs::write(s.join("notes.txt"), "x").unwrap();
        fs::write(s.join("20261027-1001.json"), "not json").unwrap();
        fs::write(s.join("20261027-1002.json"), "{\"version\":9,\"name\":\"n\",\"automatic\":false,\"pages\":{},\"assets\":[]}").unwrap();
        fs::create_dir_all(s.join("20261027-1003.json")).unwrap();
        assert_eq!(list_book_snapshots(d.path()).unwrap().len(), 1);
        assert!(list_book_snapshots(tempfile::tempdir().unwrap().path()).unwrap().is_empty(), "no folder, no snapshots");
    }

    #[test]
    fn restore_puts_everything_back_keeps_a_safety_snapshot_and_trashes_new_pages() {
        let d = book();
        let snap = create_book_snapshot(d.path(), "v1", at("20261027-1000")).unwrap();
        write_file(d.path(), "manuscript/001-a.json", "A2", None).unwrap();
        fs::remove_file(d.path().join("manuscript/002-b.json")).unwrap();
        put(d.path(), "manuscript/003-c.json", "C new");
        put(d.path(), "cadabra.json", "{\"v\":2}");
        fs::remove_file(d.path().join("assets/pic.png")).unwrap();

        let r = restore_book_snapshot(d.path(), &snap.path, at("20261027-1100")).unwrap();
        assert_eq!(r.written, ["manuscript/001-a.json", "manuscript/002-b.json"], "unchanged pages are left alone");
        assert_eq!(r.trashed, ["manuscript/003-c.json"]);
        assert_eq!(r.missing_assets, ["assets/pic.png"]);
        assert_eq!(read(d.path(), "manuscript/001-a.json"), "A1");
        assert_eq!(read(d.path(), "manuscript/002-b.json"), "B1");
        assert_eq!(read(d.path(), "cadabra.json"), "{\"v\":1}");
        assert!(!d.path().join("manuscript/003-c.json").exists());
        assert!(fs::read_dir(d.path().join(".cadabra/trash")).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with("manuscript__003-c.json")));

        // The safety snapshot has the book as it was before, so the restore can be undone.
        assert_eq!(r.safety, ".cadabra/snapshots/20261027-1100.json");
        let list = list_book_snapshots(d.path()).unwrap();
        assert_eq!((list[0].name.as_str(), list[0].automatic), ("Before restoring v1", true));
        assert_eq!(list[0].pages, ["front-matter/01-x.json", "manuscript/001-a.json", "manuscript/003-c.json", "manuscript/fr/001-a.json"]);
        let back = restore_book_snapshot(d.path(), &r.safety, at("20261027-1200")).unwrap();
        assert_eq!(back.trashed, ["manuscript/002-b.json"], "the page the first restore brought back is not in the safety snapshot");
        assert_eq!(read(d.path(), "manuscript/001-a.json"), "A2");
        assert_eq!(read(d.path(), "manuscript/003-c.json"), "C new");
        assert_eq!(read(d.path(), "cadabra.json"), "{\"v\":2}");
    }

    #[test]
    fn restore_also_keeps_the_replaced_page_text_as_a_page_snapshot() {
        let d = book();
        let snap = create_book_snapshot(d.path(), "v1", at("20261027-1000")).unwrap();
        write_file(d.path(), "manuscript/001-a.json", "A2", None).unwrap();
        restore_book_snapshot(d.path(), &snap.path, at("20261027-1100")).unwrap();
        let kept = crate::project::snapshots::list_snapshots(d.path(), "manuscript/001-a.json").unwrap();
        assert!(kept.iter().any(|e| read(d.path(), &e.path) == "A2"));
    }

    #[test]
    fn one_page_comes_back_from_a_book_snapshot() {
        let d = book();
        let snap = create_book_snapshot(d.path(), "v1", at("20261027-1000")).unwrap();
        write_file(d.path(), "manuscript/001-a.json", "A2", None).unwrap();
        put(d.path(), "manuscript/fr/001-a.json", "FR2");
        assert_eq!(read_book_snapshot_page(d.path(), &snap.path, "manuscript/001-a.json").unwrap().contents, "A1");
        let w = restore_page_from_book(d.path(), &snap.path, "manuscript/001-a.json").unwrap();
        assert_eq!(w.hash, hash_bytes(b"A1"));
        assert_eq!(read(d.path(), "manuscript/001-a.json"), "A1");
        assert_eq!(read(d.path(), "manuscript/002-b.json"), "B1", "other pages are untouched");
        let kept = crate::project::snapshots::list_snapshots(d.path(), "manuscript/001-a.json").unwrap();
        assert!(kept.iter().any(|e| read(d.path(), &e.path) == "A2"), "the replaced text is the page's newest snapshot");
        // A translation has no per-page snapshots: a whole-book copy is kept instead.
        restore_page_from_book(d.path(), &snap.path, "manuscript/fr/001-a.json").unwrap();
        assert_eq!(read(d.path(), "manuscript/fr/001-a.json"), "FR1");
        assert!(list_book_snapshots(d.path()).unwrap().iter().any(|e| e.automatic && e.pages.contains(&"manuscript/fr/001-a.json".to_string())));
        assert!(matches!(restore_page_from_book(d.path(), &snap.path, "manuscript/missing.json"), Err(ProjectError::NotFound { .. })));
        assert!(matches!(restore_page_from_book(d.path(), &snap.path, "cadabra.json"), Err(ProjectError::CannotRestore { .. })));
        assert!(matches!(read_book_snapshot_page(d.path(), &snap.path, "manuscript/missing.json"), Err(ProjectError::NotFound { .. })));
    }

    #[test]
    fn delete_removes_only_a_listed_snapshot() {
        let d = book();
        let a = create_book_snapshot(d.path(), "a", at("20261027-1000")).unwrap();
        let b = create_book_snapshot(d.path(), "b", at("20261027-1001")).unwrap();
        delete_book_snapshot(d.path(), &a.path).unwrap();
        assert_eq!(list_book_snapshots(d.path()).unwrap(), vec![b.clone()]);
        for bad in ["cadabra.json", "manuscript/001-a.json", ".cadabra/snapshots/../../cadabra.json", ".cadabra/snapshots/20261027-1000.json", ".cadabra/snapshots/x/20261027-1001.json", ".cadabra/backups/20261027-1001.json"] {
            assert!(matches!(delete_book_snapshot(d.path(), bad), Err(ProjectError::CannotRestore { .. } | ProjectError::UnsafePath { .. })), "{bad}");
            assert!(matches!(restore_book_snapshot(d.path(), bad, at("20261027-1100")), Err(ProjectError::CannotRestore { .. } | ProjectError::UnsafePath { .. })), "{bad}");
        }
        assert!(d.path().join("cadabra.json").exists() && d.path().join(&b.path).exists());
    }

    #[test]
    fn a_snapshot_naming_a_path_outside_the_pages_is_refused_before_anything_is_written() {
        let d = book();
        let pages = BTreeMap::from([("manuscript/001-a.json".to_string(), "HACK".to_string()), ("assets/evil.json".to_string(), "x".to_string())]);
        let hostile = BookFile { version: FORMAT, name: "x".into(), automatic: false, summary: None, manifest: "{}".into(), pages, assets: vec![] };
        put(d.path(), ".cadabra/snapshots/20261027-1000.json", &serde_json::to_string(&hostile).unwrap());
        let err = restore_book_snapshot(d.path(), ".cadabra/snapshots/20261027-1000.json", at("20261027-1100")).unwrap_err();
        assert_eq!(err, ProjectError::CannotRestore { path: "assets/evil.json".into() });
        assert_eq!(read(d.path(), "manuscript/001-a.json"), "A1");
        assert!(!d.path().join("assets/evil.json").exists());
        assert_eq!(list_book_snapshots(d.path()).unwrap().len(), 1, "no safety snapshot for a refused restore");
    }

    #[test]
    fn a_book_without_a_manifest_or_with_a_file_for_the_folder_is_reported() {
        let d = tempfile::tempdir().unwrap();
        assert!(matches!(create_book_snapshot(d.path(), "x", at("20261027-1000")), Err(ProjectError::NotFound { .. })));
        let e = book();
        put(e.path(), SNAPSHOTS_DIR, "a file where the folder should be");
        assert!(create_book_snapshot(e.path(), "x", at("20261027-1000")).is_err());
    }

    #[test]
    fn page_paths_are_checked() {
        for ok in ["manuscript/a.json", "back-matter/fr/01-x.json"] {
            assert!(is_book_page(ok), "{ok}");
        }
        for bad in ["cadabra.json", "manuscript/a.txt", "manuscript/a/b/c.json", "assets/a.json", "manuscript//a.json", "manuscript/a.conflict-20261027-1000.json", "manuscript"] {
            assert!(!is_book_page(bad), "{bad}");
        }
    }

    #[test]
    fn a_book_without_a_manifest_cannot_be_snapshotted() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), "manuscript/001-a.json", "A1");
        assert_eq!(create_book_snapshot(d.path(), "x", at("20261027-1000")).unwrap_err(), ProjectError::NotFound { path: MANIFEST.to_string() });
    }

    #[test]
    fn a_listed_snapshot_whose_full_text_cannot_be_read_is_not_restored() {
        let d = book();
        // It has everything the listing needs but not the manifest text, so it lists and cannot be loaded.
        put(d.path(), ".cadabra/snapshots/20261027-1000.json", "{\"version\":1,\"name\":\"x\",\"automatic\":false,\"pages\":{},\"assets\":[]}");
        assert_eq!(list_book_snapshots(d.path()).unwrap().len(), 1);
        let path = ".cadabra/snapshots/20261027-1000.json";
        assert_eq!(restore_book_snapshot(d.path(), path, at("20261027-1100")).unwrap_err(), ProjectError::CannotRestore { path: path.to_string() });
        assert!(read(d.path(), "manuscript/001-a.json") == "A1", "nothing was touched");
    }

    fn put_old_format(d: &Path, stamp: &str, name: &str) -> String {
        let rel = format!("{SNAPSHOTS_DIR}/{stamp}.json");
        put(d, &rel, &format!("{{\"version\":1,\"name\":\"{name}\",\"automatic\":false,\"manifest\":\"{{}}\",\"pages\":{{\"manuscript/001-a.json\":\"A\"}},\"assets\":[\"assets/a.png\"]}}"));
        rel
    }

    #[test]
    fn listing_reads_only_the_start_of_a_file_and_falls_back_for_old_or_oversized_heads() {
        let d = book();
        let new = create_book_snapshot(d.path(), "new", at("20261027-1000")).unwrap();
        let old = put_old_format(d.path(), "20261026-1000", "old");
        // A snapshot with a huge manifest: the head is found without reading the manifest (the summary comes first).
        write_file(d.path(), "cadabra.json", &"m".repeat(2 * 1024 * 1024), None).unwrap();
        let big = create_book_snapshot(d.path(), "big", at("20261028-1000")).unwrap();
        let head = scan_head(&d.path().join(&big.path), 4096).expect("summary lies within the first 4 KB");
        assert_eq!((head.name.as_str(), head.summary.assets, head.summary.pages.len()), ("big", 1, 4));
        assert!(scan_head(&d.path().join(&old), 4096).is_none(), "an old file has no summary to find");
        assert!(scan_head(&d.path().join(&new.path), 10).is_none(), "a prefix that ends before the summary finds nothing");
        assert!(scan_head(&d.path().join("missing.json"), 10).is_none());
        // Listing with a tiny prefix still gives the same entries, by streaming whole files.
        let tiny = list_with(d.path(), 10).unwrap();
        assert_eq!(tiny, list_book_snapshots(d.path()).unwrap());
        let by_name = |n: &str| tiny.iter().find(|e| e.name == n).unwrap().clone();
        assert_eq!((by_name("old").assets, by_name("old").pages), (1, vec!["manuscript/001-a.json".to_string()]));
        assert_eq!(by_name("big").bytes, fs::metadata(d.path().join(&big.path)).unwrap().len(), "size comes from the file's metadata");
        assert_eq!(by_name("new").pages.len(), 4);
    }

    #[test]
    fn a_zero_byte_or_headless_snapshot_file_is_skipped_when_listing() {
        let d = book();
        put(d.path(), ".cadabra/snapshots/20261027-1000.json", "");
        put(d.path(), ".cadabra/snapshots/20261027-1001.json", "{\"summary\":{\"pages\":[],\"assets\":0}}");
        put(d.path(), ".cadabra/snapshots/20261027-1002.json", "{\"version\":1,\"name\":\"n\",\"automatic\":false,\"summary\":{\"pages\":[\"x\"]}}");
        assert!(list_book_snapshots(d.path()).unwrap().is_empty());
    }

    /// A one-page book whose page text is `n` ASCII bytes.
    fn book_with_page_of(n: usize) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), "cadabra.json", "{}");
        put(d.path(), "manuscript/001-a.json", &"x".repeat(n));
        d
    }

    #[test]
    fn a_snapshot_that_can_be_created_can_be_restored_at_the_size_cap_and_one_byte_more_is_refused() {
        // The file is the page text plus a fixed amount of framing: measure it, then size the page to land exactly on the cap.
        let probe = book_with_page_of(10);
        let overhead = create_book_snapshot(probe.path(), "cap", at("20261027-1000")).unwrap().bytes - 10;
        let fit = MAX_SNAPSHOT_BYTES as usize - overhead as usize;
        let d = book_with_page_of(fit);
        let snap = create_book_snapshot(d.path(), "cap", at("20261027-1000")).unwrap();
        assert_eq!(snap.bytes, MAX_SNAPSHOT_BYTES, "exactly at the cap is allowed");
        write_file(d.path(), "manuscript/001-a.json", "changed", None).unwrap();
        let r = restore_book_snapshot(d.path(), &snap.path, at("20261027-1100")).unwrap();
        assert_eq!(r.written, ["manuscript/001-a.json"]);
        assert_eq!(read(d.path(), "manuscript/001-a.json").len(), fit, "the max-size snapshot came back whole");
        assert_eq!(read_book_snapshot_page(d.path(), &snap.path, "manuscript/001-a.json").unwrap().contents.len(), fit);

        let over = book_with_page_of(fit + 1);
        let err = create_book_snapshot(over.path(), "over", at("20261027-1000")).unwrap_err();
        assert_eq!(err, ProjectError::TooLarge { path: SNAPSHOTS_DIR.into(), max_mb: 32 });
        assert!(!over.path().join(SNAPSHOTS_DIR).exists() || list_book_snapshots(over.path()).unwrap().is_empty(), "nothing is written for a refused snapshot");
    }

    #[test]
    fn escaped_text_counts_toward_the_cap() {
        // A page of quotes is twice as long once escaped in the snapshot file, so the file, not the text, is measured.
        let d = tempfile::tempdir().unwrap();
        put(d.path(), "cadabra.json", "{}");
        put(d.path(), "manuscript/001-a.json", &"\"".repeat(MAX_SNAPSHOT_BYTES as usize / 2 + 1024));
        assert!(matches!(create_book_snapshot(d.path(), "q", at("20261027-1000")), Err(ProjectError::TooLarge { max_mb: 32, .. })));
    }

    #[test]
    fn a_book_whose_text_is_over_the_cap_is_refused_before_it_is_serialized() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), "cadabra.json", "{}");
        put(d.path(), "manuscript/001-a.json", &"x".repeat(MAX_SNAPSHOT_BYTES as usize));
        assert!(matches!(create_book_snapshot(d.path(), "q", at("20261027-1000")), Err(ProjectError::TooLarge { max_mb: 32, .. })));
    }

    fn snapshot_files(d: &Path) -> Vec<String> {
        list_book_snapshots(d).unwrap().into_iter().map(|e| e.name).collect()
    }

    fn trashed_snapshot_files(d: &Path) -> Vec<String> {
        let Ok(read) = fs::read_dir(d.join(".cadabra/trash")) else { return vec![] };
        let mut v: Vec<String> = read.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).filter(|n| n.contains("-snapshot__")).collect();
        v.sort();
        v
    }

    #[test]
    fn the_oldest_snapshots_beyond_the_count_go_to_the_trash_never_deleted() {
        let d = book();
        let first = at("20261001-1000");
        for i in 0..(MAX_SNAPSHOTS + 3) {
            create_book_snapshot(d.path(), &format!("s{i}"), first + chrono::Duration::days(i as i64)).unwrap();
        }
        let names = snapshot_files(d.path());
        assert_eq!(names.len(), MAX_SNAPSHOTS);
        assert_eq!((names.first().unwrap().as_str(), names.last().unwrap().as_str()), ("s52", "s3"), "the newest are kept");
        let trashed = trashed_snapshot_files(d.path());
        assert_eq!(trashed.len(), 3, "{trashed:?}");
        for t in &trashed {
            let text = read(d.path(), &format!(".cadabra/trash/{t}"));
            assert!(text.contains("\"name\":\"s0\"") || text.contains("\"name\":\"s1\"") || text.contains("\"name\":\"s2\""), "the content is kept");
        }
        assert!(crate::project::list_trash(d.path()).unwrap().is_empty(), "trashed snapshots are not offered as restorable pages");
    }

    #[test]
    fn the_byte_budget_prunes_oldest_first_and_never_the_new_snapshot() {
        let d = book();
        let a = create_book_snapshot(d.path(), "a", at("20261027-1000")).unwrap();
        let b = create_book_snapshot(d.path(), "b", at("20261027-1001")).unwrap();
        let c = create_book_snapshot(d.path(), "c", at("20261027-1002")).unwrap();
        let now = at("20261027-1003");
        // Room for two: the oldest goes.
        let moved = prune_book_snapshots(d.path(), &c.path, 50, a.bytes + b.bytes + c.bytes - 1, now);
        assert_eq!(moved, std::slice::from_ref(&a.path));
        assert_eq!(snapshot_files(d.path()), ["c", "b"]);
        // A budget smaller than any one snapshot still keeps the one named as `keep`.
        let moved = prune_book_snapshots(d.path(), &c.path, 50, 1, now);
        assert_eq!(moved, std::slice::from_ref(&b.path));
        assert_eq!(snapshot_files(d.path()), ["c"]);
        assert_eq!(trashed_snapshot_files(d.path()).len(), 2);
        // Within both limits nothing moves.
        assert!(prune_book_snapshots(d.path(), &c.path, 50, MAX_TOTAL_BYTES, now).is_empty());
    }

    #[test]
    fn pruning_names_do_not_collide_and_a_missing_folder_is_fine() {
        let d = book();
        let a = create_book_snapshot(d.path(), "a", at("20261027-1000")).unwrap();
        let k = create_book_snapshot(d.path(), "k", at("20261027-1001")).unwrap();
        let now = at("20261028-1000");
        fs::create_dir_all(d.path().join(".cadabra/trash")).unwrap();
        fs::write(d.path().join(".cadabra/trash/20261028-1000-snapshot__20261027-1000.json"), "earlier").unwrap();
        assert_eq!(prune_book_snapshots(d.path(), &k.path, 1, MAX_TOTAL_BYTES, now), [a.path]);
        assert_eq!(trashed_snapshot_files(d.path()).len(), 2, "the earlier trashed file was not overwritten");
        assert_eq!(read(d.path(), ".cadabra/trash/20261028-1000-snapshot__20261027-1000.json"), "earlier");
        assert!(prune_book_snapshots(tempfile::tempdir().unwrap().path(), "x", 1, 1, now).is_empty());
    }

    #[test]
    fn a_snapshot_that_cannot_be_moved_stays_and_is_not_an_error() {
        let d = book();
        let a = create_book_snapshot(d.path(), "a", at("20261027-1000")).unwrap();
        let k = create_book_snapshot(d.path(), "k", at("20261027-1001")).unwrap();
        // A file where the trash folder should be makes the move fail.
        put(d.path(), ".cadabra/trash", "a file, not a folder");
        assert!(prune_book_snapshots(d.path(), &k.path, 1, MAX_TOTAL_BYTES, at("20261028-1000")).is_empty());
        assert!(d.path().join(&a.path).exists());
    }
}

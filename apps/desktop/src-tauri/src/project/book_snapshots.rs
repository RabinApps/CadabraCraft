//! Whole-book snapshots: the manifest, every page and the list of image files, in one file under
//! `.cadabra/snapshots/<YYYYMMDD-HHMM>[~N].json`. Like the per-page versions in `snapshots.rs` they belong to this computer
//! (`.cadabra` is not synced) and hold no absolute paths. Named ones are taken by the author; restoring a book first takes an
//! automatic one ("Before restoring ...") so a restore can itself be undone.
//!
//! Image files are listed, not copied: the app never deletes or rewrites an asset, so the list is enough to tell the author
//! which images a restored chapter needs and are gone.
use super::snapshots::{is_snapshotable, SnapshotMode};
use super::{atomic_write, free_copy_name, hash_bytes, read_file, resolve, trash_file, write_file_with, FileRead, ProjectError, Result, WriteResult, MANIFEST};
use chrono::{DateTime, Utc};
use serde::{de::IgnoredAny, Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub const SNAPSHOTS_DIR: &str = ".cadabra/snapshots";
/// Longest snapshot name, in characters.
pub const MAX_NAME_CHARS: usize = 100;
/// Most text a book snapshot holds (manifest and pages together); a larger book is refused rather than half kept.
pub const MAX_BOOK_MB: u64 = 256;
const PAGE_DIRS: [&str; 3] = ["manuscript", "front-matter", "back-matter"];
const FORMAT: u32 = 1;

/// What is stored. `pages` maps a project-relative path to the file's text.
#[derive(Serialize, Deserialize)]
struct BookFile {
    version: u32,
    name: String,
    automatic: bool,
    manifest: String,
    pages: BTreeMap<String, String>,
    assets: Vec<String>,
}

/// The same file read without its texts, for listing.
#[derive(Deserialize)]
struct BookHead {
    version: u32,
    name: String,
    automatic: bool,
    pages: BTreeMap<String, IgnoredAny>,
    assets: Vec<String>,
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
    let mut found = vec![];
    for name in file_names(root, SNAPSHOTS_DIR, false)? {
        let Some(key) = parse_name(&name) else { continue };
        let path = format!("{SNAPSHOTS_DIR}/{name}");
        let Ok(bytes) = fs::read(resolve(root, &path)?) else { continue };
        let Ok(head) = serde_json::from_slice::<BookHead>(&bytes) else { continue };
        if head.version != FORMAT {
            continue;
        }
        found.push((key.clone(), BookSnapshotEntry { path, at: key.0, name: head.name, automatic: head.automatic, pages: head.pages.into_keys().collect(), assets: head.assets.len(), bytes: bytes.len() as u64 }));
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
        if total > MAX_BOOK_MB * 1024 * 1024 {
            return Err(ProjectError::TooLarge { path: SNAPSHOTS_DIR.to_string(), max_mb: MAX_BOOK_MB });
        }
        pages.insert(rel, contents);
    }
    let assets: Vec<String> = file_names(root, "assets", false)?.into_iter().map(|f| format!("assets/{f}")).collect();
    let file = BookFile { version: FORMAT, name: name.to_string(), automatic, manifest, pages, assets };
    let bytes = serde_json::to_vec(&file).map_err(|e| ProjectError::Io { message: e.to_string() })?;
    // A name already taken (two snapshots in one minute) gets `~2`, never replaces the first.
    let to = free_copy_name(root, &format!("{SNAPSHOTS_DIR}/{}.json", stamp_of(now)))?;
    atomic_write(&resolve(root, &to)?, &bytes)?;
    Ok(BookSnapshotEntry { path: to, at: stamp_of(now), name: file.name, automatic, pages: file.pages.into_keys().collect(), assets: file.assets.len(), bytes: bytes.len() as u64 })
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
        let hostile = BookFile { version: FORMAT, name: "x".into(), automatic: false, manifest: "{}".into(), pages, assets: vec![] };
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
}

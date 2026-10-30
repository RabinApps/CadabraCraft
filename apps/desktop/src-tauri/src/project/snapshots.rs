//! Chapter snapshots: earlier versions of a page kept in `.cadabra/backups/<stamp>-<path with / as __>[-N].json`, the
//! same layout the MCP server writes (`packages/project-fs`). Snapshots belong to this computer (`.cadabra` is not
//! synced) and are never read by anything except the History and recovery dialogs.
//!
//! The stamp is `YYYYMMDD-HHMM` in UTC, so "how old" and "newest" need no state besides the file names.
use super::pages::MAX_READ_BYTES;
use super::{atomic_write, free_copy_name, hash_bytes, read_file, read_regular, resolve, FileRead, ProjectError, Result, WriteResult};
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::Serialize;
use std::fs;
use std::path::Path;

pub const BACKUPS_DIR: &str = ".cadabra/backups";
/// An automatic snapshot is taken at most this often per page.
pub const SNAPSHOT_INTERVAL_MINUTES: i64 = 10;
/// Snapshots younger than this are never pruned, whatever the keep count.
pub const KEEP_DAYS: i64 = 30;
/// How far a snapshot may be newer than its page before the page counts as rolled back (a save and the snapshot taken
/// right after it, when the book closes, land within a minute or two of each other).
const STALE_TOLERANCE_MINUTES: i64 = 2;
/// Folders whose pages are snapshotted; the manifest has its own backup before a migration.
const PAGE_DIRS: [&str; 3] = ["manuscript", "front-matter", "back-matter"];

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum SnapshotMode {
    /// Skip when the newest snapshot of the page is less than `SNAPSHOT_INTERVAL_MINUTES` old.
    Throttled,
    /// Keep the text being replaced even if a snapshot was taken a moment ago (restoring an old version).
    Always,
}

/// One earlier version of a page.
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct SnapshotEntry {
    /// Project-relative path of the snapshot file.
    pub path: String,
    /// `YYYYMMDD-HHMM` (UTC) it was taken at.
    pub at: String,
}

/// A page whose newest snapshot is newer than the page itself and differs from it, for example after a cloud folder
/// put an older file back.
#[derive(Serialize, Debug, PartialEq)]
pub struct StalePage {
    pub path: String,
    pub snapshot: String,
}

pub fn is_snapshotable(rel: &str) -> bool {
    match rel.split_once('/') {
        Some((dir, file)) => PAGE_DIRS.contains(&dir) && !file.is_empty() && !file.contains('/') && file.ends_with(".json"),
        None => false,
    }
}

fn require_snapshotable(rel: &str) -> Result<()> {
    if is_snapshotable(rel) {
        Ok(())
    } else {
        Err(ProjectError::CannotRestore { path: rel.to_string() })
    }
}

fn stamp_of(t: DateTime<Utc>) -> String {
    t.format("%Y%m%d-%H%M").to_string()
}

fn parse_stamp(stamp: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(stamp, "%Y%m%d-%H%M").ok().map(|t| t.and_utc())
}

/// `(stamp, n)` when `name` is a snapshot of `rel`: `<stamp>-<flat>.json` (`n` = 1) or `<stamp>-<flat stem>~<n>.json`.
/// Older versions of the app counted with `-<n>` instead; those names still read, see `legacy` below.
fn parse_snapshot_name(name: &str, rel: &str) -> Option<(String, u32, bool)> {
    let b = name.as_bytes();
    let stamp_ok = b.len() > 14 && b[..8].iter().all(u8::is_ascii_digit) && b[8] == b'-' && b[9..13].iter().all(u8::is_ascii_digit) && b[13] == b'-';
    if !stamp_ok {
        return None;
    }
    let rest = &name[14..];
    let flat = rel.replace('/', "__");
    if rest == flat {
        return Some((name[..13].to_string(), 1, false));
    }
    let stem = flat.strip_suffix(".json")?;
    let counted = rest.strip_prefix(stem)?;
    let n = counted.strip_prefix('~').or_else(|| counted.strip_prefix('-'))?.strip_suffix(".json")?;
    let n: u32 = n.parse().ok().filter(|n| *n >= 2)?;
    Some((name[..13].to_string(), n, counted.starts_with('-')))
}

/// The snapshots of `rel`, newest first.
pub fn list_snapshots(root: &Path, rel: &str) -> Result<Vec<SnapshotEntry>> {
    require_snapshotable(rel)?;
    let read = match fs::read_dir(resolve(root, BACKUPS_DIR)?) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut found: Vec<((String, u32), String)> = vec![];
    for item in read {
        let item = item?;
        if !item.file_type()?.is_file() {
            continue;
        }
        let Some(name) = item.file_name().to_str().map(str::to_string) else { continue };
        if let Some((at, n, legacy)) = parse_snapshot_name(&name, rel) {
            let key = (at, n);
            // A legacy `<stamp>-a-2.json` is also the plain snapshot of a sibling page `a-2.json`; when that page exists, it
            // is theirs. Names with `~` cannot be mistaken for another page's.
            let sibling = legacy.then(|| format!("{}-{}.json", rel.trim_end_matches(".json"), key.1));
            if sibling.is_some_and(|s| resolve(root, &s).is_ok_and(|p| p.exists())) {
                continue;
            }
            found.push((key, name));
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(found.into_iter().map(|((at, _), name)| SnapshotEntry { path: format!("{BACKUPS_DIR}/{name}"), at }).collect())
}

/// The snapshot path must be a snapshot of this very page, so a caller cannot read or restore from any other file.
fn require_snapshot_of(root: &Path, rel: &str, snapshot: &str) -> Result<()> {
    if list_snapshots(root, rel)?.iter().any(|e| e.path == snapshot) {
        Ok(())
    } else {
        Err(ProjectError::CannotRestore { path: snapshot.to_string() })
    }
}

pub fn read_snapshot(root: &Path, rel: &str, snapshot: &str) -> Result<FileRead> {
    require_snapshot_of(root, rel, snapshot)?;
    read_file(root, snapshot)?.ok_or_else(|| ProjectError::NotFound { path: snapshot.to_string() })
}

/// A project file's bytes for comparing, read with the same cap as every other read (a page or snapshot that is not a
/// regular file within the cap is never loaded whole, so it counts as "cannot compare").
fn read_for_compare(root: &Path, rel: &str) -> Option<Vec<u8>> {
    let too_large = || ProjectError::TooLarge { path: rel.to_string(), max_mb: MAX_READ_BYTES / 1024 / 1024 };
    read_regular(&resolve(root, rel).ok()?, MAX_READ_BYTES, rel, too_large).ok()
}

fn write_copy(root: &Path, rel: &str, bytes: &[u8], now: DateTime<Utc>) -> Result<String> {
    let base = format!("{BACKUPS_DIR}/{}-{}", stamp_of(now), rel.replace('/', "__"));
    let to = free_copy_name(root, &base)?;
    atomic_write(&resolve(root, &to)?, bytes)?;
    Ok(to)
}

/// Keeps `existing` (the text about to be replaced) as a snapshot of `rel` unless it is empty, identical to what will be
/// written, identical to the newest snapshot already, or (in `Throttled` mode) the newest snapshot is recent. Returns the
/// snapshot's path when one was written.
pub fn keep_before_overwrite(root: &Path, rel: &str, existing: &[u8], new: &[u8], mode: SnapshotMode, now: DateTime<Utc>) -> Result<Option<String>> {
    if !is_snapshotable(rel) || existing.is_empty() || existing == new {
        return Ok(None);
    }
    keep(root, rel, existing, mode, now)
}

fn keep(root: &Path, rel: &str, bytes: &[u8], mode: SnapshotMode, now: DateTime<Utc>) -> Result<Option<String>> {
    if let Some(newest) = list_snapshots(root, rel)?.first() {
        if mode == SnapshotMode::Throttled && parse_stamp(&newest.at).is_some_and(|t| now - t < Duration::minutes(SNAPSHOT_INTERVAL_MINUTES)) {
            return Ok(None);
        }
        if read_for_compare(root, &newest.path).is_some_and(|old| hash_bytes(&old) == hash_bytes(bytes)) {
            return Ok(None);
        }
    }
    write_copy(root, rel, bytes, now).map(Some)
}

/// Puts a snapshot's text back as the page. The text being replaced is kept as a snapshot first, so a restore can be
/// undone from History.
pub fn restore_snapshot(root: &Path, rel: &str, snapshot: &str) -> Result<WriteResult> {
    let snap = read_snapshot(root, rel, snapshot)?;
    super::write_file_with(root, rel, &snap.contents, None, SnapshotMode::Always)
}

/// Removes the oldest snapshots of each page beyond `keep`, never touching one younger than `KEEP_DAYS`. Returns how many
/// were removed.
pub fn prune(root: &Path, rels: &[String], keep: usize, now: DateTime<Utc>) -> Result<u32> {
    let keep = keep.max(1);
    let mut removed = 0;
    for rel in rels.iter().filter(|r| is_snapshotable(r)) {
        for entry in list_snapshots(root, rel)?.into_iter().skip(keep) {
            let old_enough = parse_stamp(&entry.at).is_some_and(|t| now - t > Duration::days(KEEP_DAYS));
            if old_enough && fs::remove_file(resolve(root, &entry.path)?).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

/// Pages among `rels` that look rolled back: the newest snapshot is more than a couple of minutes newer than the page
/// file and its text differs, or the page file is empty while a snapshot exists.
pub fn find_stale(root: &Path, rels: &[String]) -> Result<Vec<StalePage>> {
    let mut out = vec![];
    for rel in rels.iter().filter(|r| is_snapshotable(r)) {
        let Some(newest) = list_snapshots(root, rel)?.into_iter().next() else { continue };
        let Ok(meta) = fs::metadata(resolve(root, rel)?) else { continue };
        let Some(live) = read_for_compare(root, rel) else { continue };
        let Some(snap) = read_for_compare(root, &newest.path) else { continue };
        if hash_bytes(&live) == hash_bytes(&snap) {
            continue;
        }
        let modified = meta.modified().map(DateTime::<Utc>::from).ok();
        let rolled_back = match (modified, parse_stamp(&newest.at)) {
            (Some(m), Some(s)) => s - m > Duration::minutes(STALE_TOLERANCE_MINUTES),
            _ => false,
        };
        if live.is_empty() || rolled_back {
            out.push(StalePage { path: rel.clone(), snapshot: newest.path });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::write_file;

    const REL: &str = "manuscript/001-a.json";

    fn at(s: &str) -> DateTime<Utc> {
        parse_stamp(s).unwrap()
    }

    fn put(d: &Path, rel: &str, text: &str) {
        let p = d.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    fn texts(d: &Path, rel: &str) -> Vec<String> {
        list_snapshots(d, rel).unwrap().iter().map(|e| fs::read_to_string(d.join(&e.path)).unwrap()).collect()
    }

    #[test]
    fn only_pages_are_snapshotable() {
        assert!(is_snapshotable("manuscript/001-a.json"));
        assert!(is_snapshotable("front-matter/01-x.json"));
        assert!(!is_snapshotable("cadabra.json"));
        assert!(!is_snapshotable("manuscript/a/b.json"));
        assert!(!is_snapshotable("manuscript/a.txt"));
        assert!(!is_snapshotable("assets/a.json"));
    }

    #[test]
    fn names_match_the_mcp_layout_and_only_their_own_page() {
        assert_eq!(parse_snapshot_name("20261027-1432-manuscript__001-a.json", REL), Some(("20261027-1432".into(), 1, false)));
        assert_eq!(parse_snapshot_name("20261027-1432-manuscript__001-a~3.json", REL), Some(("20261027-1432".into(), 3, false)));
        assert_eq!(parse_snapshot_name("20261027-1432-manuscript__001-a-3.json", REL), Some(("20261027-1432".into(), 3, true)), "legacy counter");
        assert_eq!(parse_snapshot_name("20261027-1432-manuscript__001-a~1.json", REL), None);
        assert_eq!(parse_snapshot_name("20261027-1432-manuscript__001-a-1.json", REL), None);
        assert_eq!(parse_snapshot_name("20261027-1432-manuscript__001-b.json", REL), None);
        assert_eq!(parse_snapshot_name("cadabra-20261027-1432.json", REL), None);
    }

    #[test]
    fn a_sibling_pages_snapshot_is_not_mistaken_for_a_numbered_copy() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), "manuscript/001-a.json", "A");
        put(d.path(), "manuscript/001-a-2.json", "A2");
        keep_before_overwrite(d.path(), "manuscript/001-a-2.json", b"old A2", b"A2", SnapshotMode::Always, at("20261027-1000")).unwrap().unwrap();
        assert!(list_snapshots(d.path(), "manuscript/001-a.json").unwrap().is_empty());
        assert_eq!(list_snapshots(d.path(), "manuscript/001-a-2.json").unwrap().len(), 1);
        let theirs = list_snapshots(d.path(), "manuscript/001-a-2.json").unwrap().remove(0).path;
        assert!(matches!(restore_snapshot(d.path(), "manuscript/001-a.json", &theirs), Err(ProjectError::CannotRestore { .. })));
    }

    #[test]
    fn a_counted_snapshot_of_a_is_not_a_snapshot_of_a_page_called_a_2() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), "manuscript/001-a.json", "A");
        put(d.path(), "manuscript/001-a-2.json", "A2");
        let at = at("20261027-1000");
        keep_before_overwrite(d.path(), "manuscript/001-a.json", b"v1", b"A", SnapshotMode::Always, at).unwrap().unwrap();
        let second = keep_before_overwrite(d.path(), "manuscript/001-a.json", b"v2", b"A", SnapshotMode::Always, at).unwrap().unwrap();
        assert!(second.ends_with("001-a~2.json"));
        assert_eq!(list_snapshots(d.path(), "manuscript/001-a.json").unwrap().len(), 2, "both belong to a");
        assert!(list_snapshots(d.path(), "manuscript/001-a-2.json").unwrap().is_empty(), "none belong to a-2");
    }

    #[test]
    fn keeps_the_replaced_text_and_skips_identical_or_empty() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), REL, "one");
        assert!(keep_before_overwrite(d.path(), REL, b"one", b"one", SnapshotMode::Throttled, at("20261027-1000")).unwrap().is_none());
        assert!(keep_before_overwrite(d.path(), REL, b"", b"two", SnapshotMode::Throttled, at("20261027-1000")).unwrap().is_none());
        let path = keep_before_overwrite(d.path(), REL, b"one", b"two", SnapshotMode::Throttled, at("20261027-1000")).unwrap().unwrap();
        assert_eq!(path, ".cadabra/backups/20261027-1000-manuscript__001-a.json");
        assert_eq!(texts(d.path(), REL), vec!["one"]);
    }

    #[test]
    fn throttles_to_one_per_interval_but_always_mode_does_not() {
        let d = tempfile::tempdir().unwrap();
        keep_before_overwrite(d.path(), REL, b"v1", b"v2", SnapshotMode::Throttled, at("20261027-1000")).unwrap().unwrap();
        assert!(keep_before_overwrite(d.path(), REL, b"v2", b"v3", SnapshotMode::Throttled, at("20261027-1009")).unwrap().is_none());
        keep_before_overwrite(d.path(), REL, b"v2", b"v3", SnapshotMode::Throttled, at("20261027-1010")).unwrap().unwrap();
        keep_before_overwrite(d.path(), REL, b"v3", b"v4", SnapshotMode::Always, at("20261027-1011")).unwrap().unwrap();
        assert_eq!(texts(d.path(), REL), vec!["v3", "v2", "v1"]);
    }

    #[test]
    fn a_second_snapshot_in_the_same_minute_never_overwrites_the_first() {
        let d = tempfile::tempdir().unwrap();
        keep_before_overwrite(d.path(), REL, b"v1", b"v2", SnapshotMode::Always, at("20261027-1000")).unwrap().unwrap();
        let second = keep_before_overwrite(d.path(), REL, b"v2", b"v3", SnapshotMode::Always, at("20261027-1000")).unwrap().unwrap();
        assert_eq!(second, ".cadabra/backups/20261027-1000-manuscript__001-a~2.json");
        assert_eq!(texts(d.path(), REL), vec!["v2", "v1"]);
    }

    #[test]
    fn write_file_snapshots_the_previous_text_through_the_normal_path() {
        let d = tempfile::tempdir().unwrap();
        write_file(d.path(), REL, "first", None).unwrap();
        assert!(list_snapshots(d.path(), REL).unwrap().is_empty(), "nothing to keep for a new page");
        write_file(d.path(), REL, "second", None).unwrap();
        assert_eq!(texts(d.path(), REL), vec!["first"]);
        write_file(d.path(), REL, "third", None).unwrap();
        assert_eq!(texts(d.path(), REL), vec!["first"], "throttled: the second save came right after the first");
        write_file(d.path(), "cadabra.json", "{}", None).unwrap();
        write_file(d.path(), "cadabra.json", "{ }", None).unwrap();
        assert!(!d.path().join(".cadabra/backups").read_dir().unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains("cadabra.json")));
    }

    #[test]
    fn restore_puts_the_text_back_and_keeps_what_it_replaced() {
        let d = tempfile::tempdir().unwrap();
        write_file(d.path(), REL, "old", None).unwrap();
        write_file(d.path(), REL, "new", None).unwrap();
        let old = list_snapshots(d.path(), REL).unwrap().remove(0);
        restore_snapshot(d.path(), REL, &old.path).unwrap();
        assert_eq!(fs::read_to_string(d.path().join(REL)).unwrap(), "old");
        assert_eq!(texts(d.path(), REL), vec!["new", "old"], "the replaced text is the newest snapshot");
    }

    #[test]
    fn restore_and_read_refuse_other_files() {
        let d = tempfile::tempdir().unwrap();
        write_file(d.path(), REL, "x", None).unwrap();
        for bad in ["cadabra.json", ".cadabra/backups/../../cadabra.json", ".cadabra/backups/20261027-1000-manuscript__other.json", "manuscript/001-a.json"] {
            assert!(matches!(read_snapshot(d.path(), REL, bad), Err(ProjectError::CannotRestore { .. })), "{bad}");
            assert!(matches!(restore_snapshot(d.path(), REL, bad), Err(ProjectError::CannotRestore { .. })), "{bad}");
        }
        assert!(matches!(list_snapshots(d.path(), "cadabra.json"), Err(ProjectError::CannotRestore { .. })));
    }

    #[test]
    fn prune_drops_only_old_snapshots_beyond_the_keep_count() {
        let d = tempfile::tempdir().unwrap();
        for (i, s) in ["20260801-1000", "20260802-1000", "20261001-1000", "20261020-1000"].iter().enumerate() {
            keep_before_overwrite(d.path(), REL, format!("v{i}").as_bytes(), b"next", SnapshotMode::Always, at(s)).unwrap().unwrap();
        }
        let now = at("20261027-1000");
        assert_eq!(prune(d.path(), &[REL.to_string()], 3, now).unwrap(), 1, "only the oldest is beyond 3 and older than 30 days");
        assert_eq!(texts(d.path(), REL), vec!["v3", "v2", "v1"]);
        assert_eq!(prune(d.path(), &[REL.to_string()], 1, now).unwrap(), 1, "v1 is 86 days old; v2 (26 days) and v3 are protected");
        assert_eq!(texts(d.path(), REL), vec!["v3", "v2"]);
        assert_eq!(prune(d.path(), &[REL.to_string()], 0, now).unwrap(), 0, "keep is at least 1 and the rest is recent");
    }

    #[test]
    fn stale_page_is_flagged_when_a_newer_different_snapshot_exists() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), REL, "rolled back");
        assert!(find_stale(d.path(), &[REL.to_string()]).unwrap().is_empty(), "no snapshot, nothing to recover");
        let future = Utc::now() + Duration::hours(1);
        let snap = write_copy(d.path(), REL, b"newer text", future).unwrap();
        assert_eq!(find_stale(d.path(), &[REL.to_string()]).unwrap(), vec![StalePage { path: REL.into(), snapshot: snap.clone() }]);
        put(d.path(), REL, "newer text");
        assert!(find_stale(d.path(), &[REL.to_string()]).unwrap().is_empty(), "same text: nothing to recover");
        put(d.path(), REL, "");
        assert_eq!(find_stale(d.path(), &[REL.to_string()]).unwrap().len(), 1, "an emptied page with a snapshot is recoverable");
    }

    #[test]
    fn listing_skips_foreign_entries_and_reports_an_unreadable_backups_folder() {
        let d = tempfile::tempdir().unwrap();
        let backups = d.path().join(BACKUPS_DIR);
        fs::create_dir_all(backups.join("a-folder")).unwrap();
        fs::write(backups.join("notes.txt"), "x").unwrap();
        fs::write(backups.join("20261027-1000-manuscript__002-b.json"), "other page").unwrap();
        assert!(list_snapshots(d.path(), REL).unwrap().is_empty());
        let e = tempfile::tempdir().unwrap();
        put(e.path(), BACKUPS_DIR, "a file where the folder should be");
        assert!(matches!(list_snapshots(e.path(), REL), Err(ProjectError::Io { .. })));
    }

    #[test]
    fn an_unchanged_page_is_not_snapshotted_twice_even_when_the_interval_has_passed() {
        let d = tempfile::tempdir().unwrap();
        let first = keep_before_overwrite(d.path(), REL, b"same", b"new", SnapshotMode::Throttled, at("20261027-1000")).unwrap();
        assert!(first.is_some());
        let again = keep_before_overwrite(d.path(), REL, b"same", b"newer", SnapshotMode::Throttled, at("20261027-1100")).unwrap();
        assert_eq!(again, None);
        assert_eq!(list_snapshots(d.path(), REL).unwrap().len(), 1);
    }

    #[test]
    fn a_snapshot_with_an_impossible_date_never_marks_a_page_stale() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), REL, "live text");
        put(d.path(), &format!("{BACKUPS_DIR}/20269999-9999-manuscript__001-a.json"), "different");
        assert!(find_stale(d.path(), &[REL.to_string()]).unwrap().is_empty());
    }

    #[test]
    fn a_page_or_snapshot_over_the_read_cap_is_never_loaded_to_compare() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), REL, "live");
        let big = |rel: &str| {
            let p = d.path().join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::File::create(p).unwrap().set_len(MAX_READ_BYTES + 1).unwrap();
        };
        // Not stale-checkable when the newest snapshot is over the cap (though it is newer than the page), or the page is.
        let future = Utc::now() + Duration::hours(1);
        big(&format!("{BACKUPS_DIR}/{}-manuscript__001-a.json", stamp_of(future)));
        assert!(find_stale(d.path(), &[REL.to_string()]).unwrap().is_empty());
        let kept = keep_before_overwrite(d.path(), REL, b"live", b"next", SnapshotMode::Always, at("20261027-1100")).unwrap();
        assert!(kept.is_some(), "an over-cap newest snapshot cannot equal the text, so a copy is written");
        big(REL);
        assert!(find_stale(d.path(), &[REL.to_string()]).unwrap().is_empty());
        assert_eq!(read_for_compare(d.path(), "../x"), None);
    }
}

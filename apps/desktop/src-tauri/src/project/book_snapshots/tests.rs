use super::file::scan_head;
use super::prune::{Limits, DEFAULT_SNAPSHOTS, MAX_TOTAL_BYTES};
use super::*;
use crate::project::write_file;

pub(super) fn at(s: &str) -> DateTime<Utc> {
    chrono::NaiveDateTime::parse_from_str(s, "%Y%m%d-%H%M").unwrap().and_utc()
}

pub(super) fn put(d: &Path, rel: &str, text: &str) {
    let p = d.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

pub(super) fn book() -> tempfile::TempDir {
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

pub(super) fn read(d: &Path, rel: &str) -> String {
    fs::read_to_string(d.join(rel)).unwrap()
}

#[test]
fn a_snapshot_holds_the_manifest_pages_and_asset_names_and_nothing_absolute() {
    let d = book();
    let e = create_book_snapshot(d.path(), "  Before the rewrite ", at("20261027-1000")).unwrap();
    assert_eq!(e.path, ".cadabra/snapshots/20261027-1000.json");
    assert_eq!((e.name.as_str(), e.automatic, e.assets), ("Before the rewrite", false, 1));
    assert_eq!(
        e.pages,
        ["front-matter/01-x.json", "manuscript/001-a.json", "manuscript/002-b.json", "manuscript/fr/001-a.json"],
        "conflict copies are not pages"
    );
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
    for bad in [
        "cadabra.json",
        "manuscript/001-a.json",
        ".cadabra/snapshots/../../cadabra.json",
        ".cadabra/snapshots/20261027-1000.json",
        ".cadabra/snapshots/x/20261027-1001.json",
        ".cadabra/backups/20261027-1001.json",
    ] {
        assert!(matches!(delete_book_snapshot(d.path(), bad), Err(ProjectError::CannotRestore { .. } | ProjectError::UnsafePath { .. })), "{bad}");
        assert!(
            matches!(restore_book_snapshot(d.path(), bad, at("20261027-1100")), Err(ProjectError::CannotRestore { .. } | ProjectError::UnsafePath { .. })),
            "{bad}"
        );
    }
    assert!(d.path().join("cadabra.json").exists() && d.path().join(&b.path).exists());
}

#[test]
fn a_snapshot_naming_a_path_outside_the_pages_is_refused_before_anything_is_written() {
    let d = book();
    let pages = BTreeMap::from([("manuscript/001-a.json".to_string(), "HACK".to_string()), ("assets/evil.json".to_string(), "x".to_string())]);
    let hostile = BookFile { version: FORMAT, name: "x".into(), automatic: false, pinned: false, summary: None, manifest: "{}".into(), pages, assets: vec![] };
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
    for bad in [
        "cadabra.json",
        "manuscript/a.txt",
        "manuscript/a/b/c.json",
        "assets/a.json",
        "manuscript//a.json",
        "manuscript/a.conflict-20261027-1000.json",
        "manuscript",
    ] {
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

#[test]
fn a_listed_snapshot_whose_full_text_cannot_be_read_is_not_renamed_or_pinned() {
    let d = book();
    let path = ".cadabra/snapshots/20261027-1000.json";
    put(d.path(), path, "{\"version\":1,\"name\":\"x\",\"automatic\":false,\"pages\":{},\"assets\":[]}");
    let cannot = ProjectError::CannotRestore { path: path.to_string() };
    assert_eq!(pin_book_snapshot(d.path(), path, true).unwrap_err(), cannot);
    assert_eq!(rename_book_snapshot(d.path(), path, "New name").unwrap_err(), cannot);
}

#[test]
fn a_poisoned_snapshot_lock_is_still_taken() {
    let _ = std::thread::spawn(|| {
        let _held = FILES.lock().unwrap();
        panic!("poisoned on purpose");
    })
    .join();
    drop(files_lock());
}

pub(super) fn put_old_format(d: &Path, stamp: &str, name: &str) -> String {
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
    let normal = list_book_snapshots(d.path()).unwrap(); // also upgrades the old file, so compare after it
    let tiny = list_with(d.path(), 10).unwrap();
    assert_eq!(tiny, normal);
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
pub(super) fn book_with_page_of(n: usize) -> tempfile::TempDir {
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

/// The paths the prune moved, for limits given as plain numbers.
fn prune_book_snapshots(root: &Path, keep: &str, max_count: usize, max_bytes: u64, now: DateTime<Utc>) -> Vec<String> {
    super::prune::prune_book_snapshots(root, keep, Limits { max_count, max_bytes }, now).moved
}

pub(super) fn snapshot_files(d: &Path) -> Vec<String> {
    list_book_snapshots(d).unwrap().into_iter().map(|e| e.name).collect()
}

pub(super) fn trashed_snapshot_files(d: &Path) -> Vec<String> {
    let Ok(read) = fs::read_dir(d.join(".cadabra/trash")) else { return vec![] };
    let mut v: Vec<String> = read.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).filter(|n| n.contains("-snapshot__")).collect();
    v.sort();
    v
}

#[test]
fn the_oldest_snapshots_beyond_the_count_go_to_the_trash_never_deleted() {
    let d = book();
    let first = at("20261001-1000");
    for i in 0..(DEFAULT_SNAPSHOTS + 3) {
        create_book_snapshot(d.path(), &format!("s{i}"), first + chrono::Duration::days(i as i64)).unwrap();
    }
    let names = snapshot_files(d.path());
    assert_eq!(names.len(), DEFAULT_SNAPSHOTS);
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

/// Writes a snapshot-shaped file with `page` as its one page. `summary` false writes the legacy layout.
pub(super) fn write_snap(d: &Path, stamp: &str, name: &str, automatic: bool, summary: bool, page: &str) -> String {
    let rel = format!("{SNAPSHOTS_DIR}/{stamp}.json");
    let sum = if summary { "\"summary\":{\"pages\":[\"manuscript/001-a.json\"],\"assets\":0}," } else { "" };
    put(d, &rel, &format!("{{\"version\":1,\"name\":\"{name}\",\"automatic\":{automatic},{sum}\"manifest\":\"{{}}\",\"pages\":{{\"manuscript/001-a.json\":\"{page}\"}},\"assets\":[]}}"));
    rel
}

#[test]
fn automatic_snapshots_are_pruned_before_named_ones() {
    let d = book();
    let named = create_book_snapshot(d.path(), "mine", at("20260101-0000")).unwrap();
    // Newer automatic ones go before the older named one.
    let mut autos = vec![];
    for i in 0..3 {
        autos.push(create(d.path(), &format!("auto {i}"), true, at("20260102-0000") + chrono::Duration::minutes(i)).unwrap());
    }
    let keep = create_book_snapshot(d.path(), "new", at("20260103-0000")).unwrap();
    let moved = prune_book_snapshots(d.path(), &keep.path, 3, MAX_TOTAL_BYTES, at("20260104-0000"));
    assert_eq!(moved, [autos[0].path.clone(), autos[1].path.clone()], "oldest automatic first, the named one stays");
    assert_eq!(snapshot_files(d.path()), ["new", "auto 2", "mine"]);
    // Once no automatic one is left, a named one may go (oldest first) and the new one is kept.
    let moved = prune_book_snapshots(d.path(), &keep.path, 1, MAX_TOTAL_BYTES, at("20260104-0000"));
    assert_eq!(moved, [autos[2].path.clone(), named.path.clone()]);
    assert_eq!(snapshot_files(d.path()), ["new"]);
}

#[test]
fn the_byte_budget_also_takes_automatic_ones_first() {
    let d = book();
    let named = create_book_snapshot(d.path(), "mine", at("20260101-0000")).unwrap();
    let auto = create(d.path(), "auto", true, at("20260102-0000")).unwrap();
    let keep = create_book_snapshot(d.path(), "new", at("20260103-0000")).unwrap();
    let budget = named.bytes + keep.bytes;
    assert_eq!(prune_book_snapshots(d.path(), &keep.path, 50, budget, at("20260104-0000")), [auto.path]);
    assert_eq!(snapshot_files(d.path()), ["new", "mine"]);
}

#[test]
fn more_than_the_limit_of_named_snapshots_still_prunes_the_oldest_into_the_trash_and_keeps_the_new_one() {
    let d = book();
    let first = create_book_snapshot(d.path(), "oldest", at("20260101-0000")).unwrap();
    for i in 1..=DEFAULT_SNAPSHOTS {
        create_book_snapshot(d.path(), &format!("named-{i}"), at("20260102-0000") + chrono::Duration::minutes(i as i64)).unwrap();
    }
    let names = snapshot_files(d.path());
    assert_eq!(names.len(), DEFAULT_SNAPSHOTS);
    assert_eq!(names[0], format!("named-{DEFAULT_SNAPSHOTS}"), "the one just taken is kept");
    assert!(!names.contains(&"oldest".to_string()));
    let trashed = trashed_snapshot_files(d.path());
    assert_eq!(trashed.len(), 1);
    assert!(read(d.path(), &format!(".cadabra/trash/{}", trashed[0])).contains("\"name\":\"oldest\""), "{}", first.path);
}

#[test]
fn pruning_does_not_stream_legacy_files_and_leaves_non_snapshots_alone() {
    let d = book();
    // A legacy file whose texts are not valid JSON after the first 256 KB: reading it through would fail, so pruning
    // that still recognizes and moves it proves it only looked at the start.
    let junk = "x".repeat(300 * 1024);
    let legacy = write_snap(d.path(), "20260101-0000", "legacy", true, false, &junk);
    let text = read(d.path(), &legacy);
    fs::write(d.path().join(&legacy), &text[..text.len() - 20]).unwrap();
    assert!(read_head_slow(&d.path().join(&legacy), HEAD_BYTES).is_none(), "the whole-file read would fail");
    let other = write_snap(d.path(), "20260102-0000", "other", false, true, "p");
    put(d.path(), ".cadabra/snapshots/20260103-0000.json", "not a snapshot");
    let moved = prune_book_snapshots(d.path(), &other, 1, MAX_TOTAL_BYTES, at("20260104-0000"));
    assert_eq!(moved, [legacy]);
    assert!(d.path().join(".cadabra/snapshots/20260103-0000.json").exists(), "a non-snapshot is not touched");
}

#[test]
fn a_legacy_snapshot_is_listed_upgraded_once_and_restores_identically() {
    let d = book();
    let rel = put_old_format(d.path(), "20260101-0000", "old");
    let file = d.path().join(&rel);
    let before: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert!(scan_head(&file, HEAD_BYTES).is_none());
    let first = list_book_snapshots(d.path()).unwrap();
    assert_eq!((first[0].name.as_str(), first[0].assets, first[0].pages.clone()), ("old", 1, vec!["manuscript/001-a.json".to_string()]));
    assert!(scan_head(&file, HEAD_BYTES).is_some(), "the file now has a summary in its head");
    assert_eq!(first[0].bytes, fs::metadata(&file).unwrap().len(), "bytes are read after the rewrite");
    let mut after: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert_eq!(after["summary"], serde_json::json!({"pages": ["manuscript/001-a.json"], "assets": 1}));
    after.as_object_mut().unwrap().remove("summary");
    assert_eq!(after, before, "nothing but the summary was added");
    // Listed again: not rewritten.
    let written = fs::read(&file).unwrap();
    let again = list_book_snapshots(d.path()).unwrap();
    assert_eq!(again, first);
    assert_eq!(fs::read(&file).unwrap(), written);
    // And it restores identically.
    write_file(d.path(), "manuscript/001-a.json", "changed", None).unwrap();
    restore_book_snapshot(d.path(), &rel, at("20260102-0000")).unwrap();
    assert_eq!(read(d.path(), "manuscript/001-a.json"), "A");
}

#[test]
fn a_legacy_snapshot_over_the_cap_is_listed_but_not_rewritten_and_a_failed_rewrite_is_ignored() {
    let d = book();
    let big = write_snap(d.path(), "20260101-0000", "big", false, false, &"x".repeat(MAX_SNAPSHOT_BYTES as usize));
    let bytes = fs::read(d.path().join(&big)).unwrap();
    assert!(bytes.len() as u64 > MAX_SNAPSHOT_BYTES);
    assert_eq!(snapshot_files(d.path()), ["big"]);
    assert_eq!(fs::read(d.path().join(&big)).unwrap(), bytes, "left as it was");
    // A rewrite that cannot happen (file gone, not a snapshot) changes nothing and does not panic.
    upgrade_legacy(&d.path().join("missing.json"));
    let small = put_old_format(d.path(), "20260102-0000", "small");
    fs::write(
        d.path().join(&small),
        "{\"version\":1,\"name\":\"n\",\"automatic\":false,\"summary\":{\"pages\":[],\"assets\":0},\"manifest\":\"\",\"pages\":{},\"assets\":[]}",
    )
    .unwrap();
    let before = fs::read(d.path().join(&small)).unwrap();
    upgrade_legacy(&d.path().join(&small));
    assert_eq!(fs::read(d.path().join(&small)).unwrap(), before, "a file that already has a summary is left alone");
}

//! Limits passed in by the caller, pinned snapshots, and renaming (see `prune.rs` and `edit.rs`).
use super::file::{scan_flags, scan_head};
use super::prune::{prune_under_ceiling, Pruned, DEFAULT_SNAPSHOTS, MAX_SNAPSHOTS, MAX_TOTAL_BYTES, MIN_SNAPSHOTS, MIN_TOTAL_BYTES};
use super::tests::{at, book, book_with_page_of, put, put_old_format, read, snapshot_files, trashed_snapshot_files, write_snap};
use super::*;
use crate::project::write_file;

fn limits(max_count: usize, max_bytes: u64) -> Limits {
    Limits { max_count, max_bytes }
}

fn entry_named(d: &Path, name: &str) -> BookSnapshotEntry {
    list_book_snapshots(d).unwrap().into_iter().find(|e| e.name == name).unwrap_or_else(|| panic!("no snapshot named {name}"))
}

fn nothing() -> PruneReport {
    PruneReport { moved: 0, pinned_moved: vec![] }
}

#[test]
fn limits_from_a_caller_are_clamped_and_bad_values_become_the_default() {
    assert_eq!(Limits::from_args(None, None), Limits::DEFAULT);
    assert_eq!(Limits::from_args(Some(20.0), Some(500.0)), limits(20, 500 * 1024 * 1024));
    assert_eq!(Limits::from_args(Some(1.0), Some(1.0)), limits(MIN_SNAPSHOTS, MIN_TOTAL_BYTES), "below the minimum");
    assert_eq!(Limits::from_args(Some(0.0), Some(0.0)), limits(MIN_SNAPSHOTS, MIN_TOTAL_BYTES));
    assert_eq!(Limits::from_args(Some(1e12), Some(1e12)), limits(MAX_SNAPSHOTS, MAX_TOTAL_BYTES), "above the hard bound");
    assert_eq!(Limits::from_args(Some(f64::INFINITY), Some(1e300)), limits(DEFAULT_SNAPSHOTS, MAX_TOTAL_BYTES), "infinity is not a number");
    assert_eq!(Limits::from_args(Some(f64::NAN), Some(-5.0)), Limits::DEFAULT);
    assert_eq!(Limits::from_args(Some(-1.0), Some(f64::NEG_INFINITY)), Limits::DEFAULT);
    assert_eq!(Limits::from_args(Some(7.9), Some(100.5)), limits(7, 100 * 1024 * 1024), "fractions round down");
    assert_eq!(Limits::from_args(Some(200.0), Some(4096.0)), limits(MAX_SNAPSHOTS, MAX_TOTAL_BYTES));
}

#[test]
fn creating_a_snapshot_keeps_to_the_limits_it_is_given_and_reports_how_many_moved() {
    let d = book();
    let first = at("20261001-1000");
    for i in 0..8 {
        let made = create_book_snapshot_with(d.path(), &format!("s{i}"), first + chrono::Duration::days(i), limits(5, MAX_TOTAL_BYTES)).unwrap();
        assert_eq!(made.pruned.moved, u32::from(i >= 5), "snapshot {i}");
        assert!(made.pruned.pinned_moved.is_empty());
    }
    assert_eq!(snapshot_files(d.path()), ["s7", "s6", "s5", "s4", "s3"]);
    assert_eq!(trashed_snapshot_files(d.path()).len(), 3);
    // A bigger limit later keeps what is left; nothing comes back and nothing else moves.
    let made = create_book_snapshot_with(d.path(), "s8", first + chrono::Duration::days(9), limits(200, MAX_TOTAL_BYTES)).unwrap();
    assert_eq!(made.pruned, nothing());
    assert_eq!(snapshot_files(d.path()).len(), 6);
}

#[test]
fn the_prune_on_open_applies_a_lowered_limit_and_counts_the_moves() {
    let d = book();
    for i in 0..10 {
        create_book_snapshot_with(d.path(), &format!("s{i}"), at("20261001-1000") + chrono::Duration::days(i), Limits::DEFAULT).unwrap();
    }
    assert_eq!(prune_to_limits(d.path(), Limits::DEFAULT, at("20261101-1000")), nothing());
    let report = prune_to_limits(d.path(), limits(6, MAX_TOTAL_BYTES), at("20261101-1000"));
    assert_eq!(report, PruneReport { moved: 4, pinned_moved: vec![] });
    assert_eq!(snapshot_files(d.path()), ["s9", "s8", "s7", "s6", "s5", "s4"]);
    assert_eq!(trashed_snapshot_files(d.path()).len(), 4, "moved, never deleted");
    let by_bytes = prune_to_limits(d.path(), limits(DEFAULT_SNAPSHOTS, 1), at("20261101-1000"));
    assert_eq!(by_bytes.moved, 6, "a byte limit below one snapshot moves them all when there is nothing to keep");
}

#[test]
fn a_restore_does_not_trim_snapshots_to_limits_it_does_not_know() {
    let d = book();
    let first = at("20260101-0000");
    for i in 0..(DEFAULT_SNAPSHOTS + 5) {
        create_book_snapshot_with(d.path(), &format!("s{i}"), first + chrono::Duration::days(i as i64), limits(MAX_SNAPSHOTS, MAX_TOTAL_BYTES)).unwrap();
    }
    let target = entry_named(d.path(), "s0");
    restore_book_snapshot(d.path(), &target.path, at("20270101-0000")).unwrap();
    assert_eq!(list_book_snapshots(d.path()).unwrap().len(), DEFAULT_SNAPSHOTS + 6, "the safety snapshot is added and nothing is pruned");
    assert!(trashed_snapshot_files(d.path()).is_empty());
}

#[test]
fn pinning_is_written_in_the_head_and_old_files_are_not_pinned() {
    let d = book();
    let legacy = put_old_format(d.path(), "20260101-0000", "old");
    let a = create_book_snapshot(d.path(), "a", at("20261027-1000")).unwrap();
    assert!(!a.pinned && !read(d.path(), &a.path).contains("pinned"), "an unpinned file is written as before");
    assert!(!entry_named(d.path(), "old").pinned);
    let pinned = pin_book_snapshot(d.path(), &a.path, true).unwrap();
    assert!(pinned.pinned);
    assert_eq!(pinned, entry_named(d.path(), "a"), "the entry returned is what listing shows");
    let raw = read(d.path(), &a.path);
    assert!(raw.find("\"pinned\":true").unwrap() < raw.find("\"summary\"").unwrap(), "pinned precedes the summary: {raw}");
    assert_eq!(scan_flags(&d.path().join(&a.path), 128), Some((false, true)), "the flags are read from the first bytes");
    assert_eq!(scan_flags(&d.path().join(&legacy), HEAD_BYTES), Some((false, false)));
    assert!(scan_head(&d.path().join(&a.path), HEAD_BYTES).unwrap().pinned);
    // Unpinning leaves the file as an unpinned one is written.
    assert!(!pin_book_snapshot(d.path(), &a.path, false).unwrap().pinned);
    assert!(!read(d.path(), &a.path).contains("pinned"));
    // A pinned file written by hand in the old whole-file layout (no summary) is read through for the flag.
    put(
        d.path(),
        ".cadabra/snapshots/20260102-0000.json",
        "{\"version\":1,\"name\":\"hand\",\"automatic\":true,\"pinned\":true,\"manifest\":\"{}\",\"pages\":{},\"assets\":[]}",
    );
    let hand = entry_named(d.path(), "hand");
    assert!(hand.pinned && hand.automatic);
}

#[test]
fn a_pinned_snapshot_survives_the_count_and_byte_limits() {
    let d = book();
    let old = create_book_snapshot(d.path(), "keepsake", at("20260101-0000")).unwrap();
    let auto_old = create(d.path(), "auto", true, at("20260102-0000")).unwrap();
    for i in 0..4 {
        create_book_snapshot(d.path(), &format!("n{i}"), at("20260103-0000") + chrono::Duration::days(i)).unwrap();
    }
    pin_book_snapshot(d.path(), &old.path, true).unwrap();
    let newest = list_book_snapshots(d.path()).unwrap()[0].path.clone();
    let out = super::prune::prune_book_snapshots(d.path(), &newest, limits(2, MAX_TOTAL_BYTES), at("20270101-0000"));
    assert_eq!(out.moved.len(), 4, "everything but the pinned one and the newest is moved");
    assert!(out.moved.contains(&auto_old.path) && out.pinned_moved.is_empty());
    assert_eq!(snapshot_files(d.path()), ["n3", "keepsake"]);
    // A byte limit of 1 still leaves the pinned one and the one just taken.
    assert_eq!(super::prune::prune_book_snapshots(d.path(), &newest, limits(1, 1), at("20270101-0000")), Pruned::default());
    assert_eq!(snapshot_files(d.path()), ["n3", "keepsake"]);
    // It restores like any other.
    write_file(d.path(), "manuscript/001-a.json", "changed", None).unwrap();
    restore_book_snapshot(d.path(), &old.path, at("20270102-0000")).unwrap();
    assert_eq!(read(d.path(), "manuscript/001-a.json"), "A1");
}

#[test]
fn pinned_snapshots_move_only_past_the_hard_ceiling_oldest_first_and_are_reported() {
    let d = book();
    let a = create_book_snapshot(d.path(), "a", at("20260101-0000")).unwrap();
    let b = create_book_snapshot(d.path(), "b", at("20260102-0000")).unwrap();
    let c = create_book_snapshot(d.path(), "c", at("20260103-0000")).unwrap();
    let keep = create_book_snapshot(d.path(), "keep", at("20260104-0000")).unwrap();
    for e in [&a, &b, &c] {
        pin_book_snapshot(d.path(), &e.path, true).unwrap();
    }
    let total: u64 = [&a, &b, &c, &keep].iter().map(|e| fs::metadata(d.path().join(&e.path)).unwrap().len()).sum();
    let now = at("20270101-0000");
    // Under the ceiling nothing moves even with tiny user limits.
    assert_eq!(prune_under_ceiling(d.path(), &keep.path, limits(1, 1), total, now), Pruned::default());
    // One byte over the ceiling: the oldest pinned one goes, and the report names it.
    let one = prune_under_ceiling(d.path(), &keep.path, limits(1, 1), total - 1, now);
    assert_eq!((one.moved, one.pinned_moved), (vec![a.path.clone()], vec![a.path.clone()]));
    // A ceiling of zero moves every pinned one but never the snapshot just taken.
    let rest = prune_under_ceiling(d.path(), &keep.path, limits(1, 1), 0, now);
    assert_eq!(rest.pinned_moved, [b.path, c.path]);
    assert_eq!(snapshot_files(d.path()), ["keep"]);
    assert_eq!(trashed_snapshot_files(d.path()).len(), 3, "moved to the trash, not deleted");
    assert_eq!(PruneReport::from(rest).moved, 2);
}

#[test]
fn rename_trims_and_checks_the_name_and_an_automatic_snapshot_becomes_named() {
    let d = book();
    let auto = create(d.path(), "Before restoring x", true, at("20261027-1000")).unwrap();
    let named = create_book_snapshot(d.path(), "plain", at("20261027-1001")).unwrap();
    let before = read(d.path(), &auto.path);
    for bad in ["", "   ", "tab\there", &"x".repeat(101)] {
        assert_eq!(rename_book_snapshot(d.path(), &auto.path, bad).unwrap_err(), ProjectError::InvalidFileName, "{bad:?}");
    }
    assert_eq!(read(d.path(), &auto.path), before, "a refused name changes nothing");
    let r = rename_book_snapshot(d.path(), &auto.path, "  Chapter four rewrite ").unwrap();
    assert_eq!((r.name.as_str(), r.automatic, r.path.as_str(), r.at.as_str()), ("Chapter four rewrite", false, auto.path.as_str(), "20261027-1000"));
    assert_eq!(r, entry_named(d.path(), "Chapter four rewrite"));
    let after: serde_json::Value = serde_json::from_str(&read(d.path(), &auto.path)).unwrap();
    let mut was: serde_json::Value = serde_json::from_str(&before).unwrap();
    was["name"] = "Chapter four rewrite".into();
    was["automatic"] = false.into();
    assert_eq!(after, was, "only the name and the flag changed");
    assert_eq!(rename_book_snapshot(d.path(), &named.path, &"é".repeat(100)).unwrap().name.chars().count(), 100);
    assert!(fs::read_dir(d.path().join(SNAPSHOTS_DIR)).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains("tmp")), "no temp file is left");
}

#[test]
fn rename_and_pin_only_touch_listed_snapshots() {
    let d = book();
    let e = create_book_snapshot(d.path(), "a", at("20261027-1000")).unwrap();
    for bad in [
        "cadabra.json",
        "../cadabra.json",
        ".cadabra/snapshots/../../cadabra.json",
        ".cadabra/snapshots/20261027-1234.json",
        ".cadabra/snapshots/notes.txt",
        "",
    ] {
        assert!(matches!(rename_book_snapshot(d.path(), bad, "n"), Err(ProjectError::CannotRestore { .. })), "{bad}");
        assert!(matches!(pin_book_snapshot(d.path(), bad, true), Err(ProjectError::CannotRestore { .. })), "{bad}");
    }
    assert_eq!(read(d.path(), "cadabra.json"), "{\"v\":1}");
    assert_eq!(list_book_snapshots(d.path()).unwrap(), vec![e]);
}

#[test]
fn renaming_or_pinning_a_snapshot_at_the_size_cap_is_refused_and_leaves_the_file_alone() {
    let probe = book_with_page_of(10);
    let overhead = create_book_snapshot(probe.path(), "cap", at("20261027-1000")).unwrap().bytes - 10;
    let d = book_with_page_of(MAX_SNAPSHOT_BYTES as usize - overhead as usize);
    let snap = create_book_snapshot(d.path(), "cap", at("20261027-1000")).unwrap();
    assert_eq!(snap.bytes, MAX_SNAPSHOT_BYTES);
    let before = fs::read(d.path().join(&snap.path)).unwrap();
    let too_large = ProjectError::TooLarge { path: SNAPSHOTS_DIR.into(), max_mb: 32 };
    assert_eq!(rename_book_snapshot(d.path(), &snap.path, "capp").unwrap_err(), too_large, "one more character is over");
    assert_eq!(pin_book_snapshot(d.path(), &snap.path, true).unwrap_err(), too_large);
    assert_eq!(fs::read(d.path().join(&snap.path)).unwrap(), before);
    // The same length, and a shorter name, fit.
    assert_eq!(rename_book_snapshot(d.path(), &snap.path, "cop").unwrap().bytes, MAX_SNAPSHOT_BYTES);
    assert!(rename_book_snapshot(d.path(), &snap.path, "c").unwrap().bytes < MAX_SNAPSHOT_BYTES);
    // A file over the cap (written by hand) is refused too, not read into memory.
    let big = write_snap(d.path(), "20260101-0000", "big", false, true, &"x".repeat(MAX_SNAPSHOT_BYTES as usize));
    assert_eq!(rename_book_snapshot(d.path(), &big, "n").unwrap_err(), too_large);
}

#[test]
fn renaming_a_legacy_snapshot_adds_its_summary_and_keeps_the_texts() {
    let d = book();
    let rel = put_old_format(d.path(), "20260101-0000", "old");
    let r = rename_book_snapshot(d.path(), &rel, "new name").unwrap();
    assert_eq!((r.name.as_str(), r.assets, r.pages.clone()), ("new name", 1, vec!["manuscript/001-a.json".to_string()]));
    write_file(d.path(), "manuscript/001-a.json", "changed", None).unwrap();
    restore_book_snapshot(d.path(), &rel, at("20260102-0000")).unwrap();
    assert_eq!(read(d.path(), "manuscript/001-a.json"), "A");
}

#[test]
fn renames_pins_and_new_snapshots_at_the_same_time_all_land() {
    let d = book();
    let snaps: Vec<_> = (0..6).map(|i| create_book_snapshot(d.path(), &format!("s{i}"), at("20261027-1000") + chrono::Duration::minutes(i)).unwrap()).collect();
    std::thread::scope(|s| {
        for (i, e) in snaps.iter().enumerate() {
            let root = d.path();
            s.spawn(move || {
                rename_book_snapshot(root, &e.path, &format!("renamed {i}")).unwrap();
                pin_book_snapshot(root, &e.path, true).unwrap();
            });
            s.spawn(move || {
                create_book_snapshot(root, &format!("extra {i}"), at("20261028-1000")).unwrap();
            });
        }
    });
    let all = list_book_snapshots(d.path()).unwrap();
    assert_eq!(all.len(), 12, "no snapshot was lost or replaced");
    for i in 0..6 {
        let e = all.iter().find(|e| e.name == format!("renamed {i}")).unwrap();
        assert!(e.pinned && !e.automatic, "{e:?}");
        assert!(read(d.path(), &e.path).contains("\"manifest\""), "the file is whole");
    }
}

#[test]
fn a_listed_snapshot_whose_full_text_is_damaged_cannot_be_renamed_or_pinned() {
    let d = book();
    // The head lists fine; the rest has no manifest, so the whole file does not parse.
    let rel = ".cadabra/snapshots/20261027-1000.json";
    put(d.path(), rel, "{\"version\":1,\"name\":\"x\",\"automatic\":false,\"pages\":{},\"assets\":[]}");
    assert_eq!(list_book_snapshots(d.path()).unwrap().len(), 1);
    let cannot = ProjectError::CannotRestore { path: rel.to_string() };
    assert_eq!(rename_book_snapshot(d.path(), rel, "new").unwrap_err(), cannot);
    assert_eq!(pin_book_snapshot(d.path(), rel, true).unwrap_err(), cannot);
}

#[test]
fn a_poisoned_files_lock_does_not_stop_snapshots() {
    assert!(std::thread::spawn(|| {
        let _held = super::files_lock();
        panic!("poison the lock");
    })
    .join()
    .is_err());
    let d = book();
    let made = create_book_snapshot(d.path(), "after the panic", at("20261027-1000")).unwrap();
    assert!(pin_book_snapshot(d.path(), &made.path, true).unwrap().pinned);
}

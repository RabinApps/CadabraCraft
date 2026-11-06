//! Edge cases, second half: special files, a link swapped between check and use, concurrency and clock extremes.
//! See `edge_tests.rs` for the first half and the shared helpers.
use super::edge_tests::{PAGE, at, book, temp_files, within};
use super::snapshots::SnapshotMode;
use super::*;
use chrono::{DateTime, Utc};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ---- 5. special files --------------------------------------------------------------------------------------------

#[cfg(unix)]
fn mkfifo(path: &Path) {
    assert!(std::process::Command::new("mkfifo").arg(path).status().unwrap().success());
}

/// A fifo, a socket, a link to a device, a folder and a dangling link, all named `<stem>.<ext>` in `dir`.
#[cfg(unix)]
fn special_files(dir: &Path, ext: &str) -> (Vec<PathBuf>, Vec<std::os::unix::net::UnixListener>) {
    fs::create_dir_all(dir).unwrap();
    let p = |stem: &str| dir.join(format!("{stem}.{ext}"));
    mkfifo(&p("fifo"));
    let socket = std::os::unix::net::UnixListener::bind(p("sock")).unwrap();
    std::os::unix::fs::symlink("/dev/null", p("null")).unwrap();
    std::os::unix::fs::symlink("/dev/zero", p("zero")).unwrap();
    fs::create_dir(p("dir")).unwrap();
    std::os::unix::fs::symlink(dir.join("does-not-exist"), p("dangling")).unwrap();
    (["fifo", "sock", "null", "zero", "dir", "dangling"].iter().map(|s| p(s)).collect(), vec![socket])
}

#[cfg(unix)]
#[test]
fn special_files_picked_as_an_import_source_or_reference_source_are_typed_errors_and_never_hang() {
    let d = book();
    let src = tempfile::tempdir().unwrap();
    let (txt, _keep) = special_files(&src.path().join("t"), "txt");
    let (png, _keep2) = special_files(&src.path().join("p"), "png");
    for path in txt.iter().chain(&png) {
        let (root, p) = (d.path().to_path_buf(), path.clone());
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let (reference, image, document) = within(move || (import_reference(&root, &p), import_image(&root, &p), crate::import_src::read_source(&p)));
        assert!(reference.is_err(), "reference {name}: {reference:?}");
        if name.ends_with(".png") {
            assert!(image.is_err(), "image {name}: {image:?}");
        }
        if name.ends_with(".txt") {
            assert!(document.is_err(), "document {name}: {document:?}");
        }
    }
    assert_eq!(fs::read_dir(d.path().join("references")).map(|r| r.count()).unwrap_or(0), 0, "nothing was imported, no temp file is left");
    assert_eq!(fs::read_dir(d.path().join("assets")).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn special_files_inside_the_project_are_typed_errors_for_every_page_and_reference_operation() {
    let d = book();
    let (pages, _k1) = special_files(&d.path().join("manuscript"), "json");
    let (refs_txt, _k2) = special_files(&d.path().join("references"), "txt");
    let (refs_mp4, _k3) = special_files(&d.path().join("references"), "mp4");
    for path in pages {
        let rel = format!("manuscript/{}", path.file_name().unwrap().to_string_lossy());
        let (root, r) = (d.path().to_path_buf(), rel.clone());
        let (read, write, trash, snaps) = within(move || (read_file(&root, &r), write_file(&root, &r, "x", None), trash_file(&root, &r), snapshots::list_snapshots(&root, &r)));
        assert!(read.is_err(), "read {rel}: {read:?}");
        assert!(write.is_err(), "write {rel}: {write:?}");
        assert!(trash.is_err(), "trash {rel}: {trash:?}");
        assert!(snaps.is_ok(), "listing history of {rel}");
        assert!(path.symlink_metadata().is_ok(), "{rel} is still there");
    }
    for path in refs_txt.iter().chain(&refs_mp4) {
        let rel = format!("references/{}", path.file_name().unwrap().to_string_lossy());
        let (root, r) = (d.path().to_path_buf(), rel.clone());
        let name = rel.clone();
        let (stat, range, open, media) = within(move || (stat_reference(&root, &r), read_reference_range(&root, &r, 0, 10), reference_open_path(&root, &r), read_media(&root, &r, None)));
        let is_mp4 = name.ends_with(".mp4");
        assert!(stat.is_err(), "stat {name}: {stat:?}");
        assert!(range.is_err(), "range {name}: {range:?}");
        assert!(open.is_err(), "open {name}: {open:?}");
        if is_mp4 {
            assert!(media.is_err(), "media {name}: {media:?}");
        }
    }
    // Trashing a link or a fifo or a folder from references: a link to a file inside is moved as a link, never followed out.
    for path in refs_txt.iter().chain(&refs_mp4) {
        let rel = format!("references/{}", path.file_name().unwrap().to_string_lossy());
        let (root, r) = (d.path().to_path_buf(), rel.clone());
        let trashed = within(move || trash_reference(&root, &r));
        if let Ok(to) = trashed {
            // Only a link to a device or a dangling link counts as a "file" here; moving it moves the link itself.
            assert!(d.path().join(&to).symlink_metadata().is_ok(), "{rel} -> {to}");
            assert!(Path::new("/dev/null").exists() && Path::new("/dev/zero").exists());
        }
    }
    assert!(temp_files(d.path()).is_empty());
}

#[cfg(unix)]
#[test]
fn a_special_file_is_not_a_book_page_or_asset() {
    let d = book();
    let (specials, _k) = special_files(&d.path().join("manuscript"), "json");
    let (assets, _k2) = special_files(&d.path().join("assets"), "png");
    // Book snapshots list pages by file type, so none of these is read (a fifo would hang the read).
    write_file(d.path(), PAGE, "real", None).unwrap();
    let root = d.path().to_path_buf();
    let snap = within(move || book_snapshots::create_book_snapshot(&root, "specials", at(2026, 1, 1, 0, 0))).unwrap();
    assert_eq!(snap.pages, vec![PAGE.to_string()]);
    assert_eq!(snap.assets, 0, "special files are not images");
    for path in assets {
        let rel = format!("assets/{}", path.file_name().unwrap().to_string_lossy());
        let (root, r) = (d.path().to_path_buf(), rel.clone());
        assert!(within(move || read_asset(&root, &r)).is_err(), "{rel}");
    }
    assert!(specials.iter().all(|p| p.symlink_metadata().is_ok()));
}

// ---- 6. a link swapped between check and use ----------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn a_link_planted_before_the_call_is_refused() {
    let d = book();
    let outside = tempfile::tempdir().unwrap();
    write_file(d.path(), PAGE, "A", None).unwrap();
    fs::remove_dir_all(d.path().join(".cadabra")).unwrap();
    std::os::unix::fs::symlink(outside.path(), d.path().join(".cadabra")).unwrap();
    assert!(matches!(trash_file(d.path(), PAGE), Err(ProjectError::PathEscape { .. })));
    assert!(write_file(d.path(), PAGE, "B", None).is_ok(), "a save does not touch .cadabra when there is nothing to keep");
    assert!(matches!(book_snapshots::create_book_snapshot(d.path(), "x", at(2026, 1, 1, 0, 0)), Err(ProjectError::PathEscape { .. })));
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0, "nothing was written outside");
    assert!(d.path().join(PAGE).exists());
}

#[cfg(unix)]
#[test]
fn a_link_swapped_in_after_the_path_was_checked_never_loses_the_page() {
    // FINDING (not fixable without openat/O_NOFOLLOW): `resolve` checks the path, and the move then uses the path again, so a
    // folder replaced by a link in between redirects the move. Needs a local attacker who can already write the project
    // folder. This pins what is guaranteed regardless: the page is in exactly one place afterwards, whole.
    let d = book();
    let outside = tempfile::tempdir().unwrap();
    write_file(d.path(), PAGE, "A", None).unwrap();
    let from = d.path().join(PAGE);
    let root = d.path();
    let swapped = std::cell::Cell::new(false);
    let r = fsio::move_to_free_name_with(root, &from, ".cadabra/trash/x-a.json", "a", paths::free_name, |from, to| {
        // `to` was resolved and is inside the project; now the trash folder becomes a link out of it.
        fs::remove_dir_all(root.join(".cadabra/trash")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join(".cadabra/trash")).unwrap();
        swapped.set(true);
        fsio::rename_no_replace(from, to)
    });
    assert!(swapped.get());
    let inside_copies = from.is_file() as usize; // (the trash path now leads out through the link, so it is the outside copy)
    let outside_copies = outside.path().join("x-a.json").is_file() as usize;
    assert!(r.is_ok());
    assert_eq!(inside_copies + outside_copies, 1, "the page exists once");
    let kept = [from, outside.path().join("x-a.json")].into_iter().find(|p| p.is_file()).unwrap();
    assert_eq!(fs::read_to_string(kept).unwrap(), "A");
    // The next operation sees the link and refuses.
    assert!(trash_file(root, "manuscript/none.json").is_err());
    assert!(matches!(resolve(root, ".cadabra/trash/y.json"), Err(ProjectError::PathEscape { .. })));
}

// ---- 7. concurrency ----------------------------------------------------------------------------------------------

#[test]
fn concurrent_saves_snapshots_trash_and_listing_lose_no_unseen_update_and_leave_no_temp_files() {
    let d = book();
    const HOT: &str = "manuscript/001-hot.json";
    write_file(d.path(), HOT, "v0", None).unwrap();
    for i in 0..4 {
        write_file(d.path(), &format!("manuscript/00{}-p.json", i + 2), "p", None).unwrap();
    }
    let root = d.path();
    let seen = Mutex::new(HashSet::from(["v0".to_string()]));
    let written = Mutex::new(vec![]);
    let snapshots_made = Mutex::new(0usize);
    std::thread::scope(|s| {
        for t in 0..4 {
            let (seen, written) = (&seen, &written);
            s.spawn(move || {
                for k in 0..6 {
                    let cur = read_file(root, HOT).unwrap().unwrap();
                    seen.lock().unwrap().insert(cur.contents.clone());
                    let value = format!("t{t}-{k}");
                    written.lock().unwrap().push(value.clone());
                    write_file(root, HOT, &value, Some(&cur.hash)).unwrap();
                }
            });
        }
        s.spawn(|| {
            for _ in 0..4 {
                book_snapshots::create_book_snapshot(root, "during", Utc::now()).unwrap_or_else(|e| panic!("snapshot during writes failed: {e:?}"));
                *snapshots_made.lock().unwrap() += 1;
            }
        });
        s.spawn(|| {
            for i in 0..4 {
                let page = format!("manuscript/00{}-p.json", i + 2);
                let trashed = trash_file(root, &page).unwrap();
                let back = restore_trash(root, &trashed).unwrap();
                assert_eq!(back, page);
            }
        });
        s.spawn(|| {
            for _ in 0..30 {
                list_trash(root).unwrap();
                book_snapshots::list_book_snapshots(root).unwrap();
                snapshots::list_snapshots(root, HOT).unwrap();
            }
        });
    });
    // Every value that was written is on disk, kept as a conflict copy, or was seen by a writer before it was replaced.
    let mut kept: HashSet<String> = seen.into_inner().unwrap();
    kept.insert(fs::read_to_string(root.join(HOT)).unwrap());
    for item in fs::read_dir(root.join("manuscript")).unwrap().flatten() {
        if item.file_name().to_string_lossy().contains(".conflict-") {
            kept.insert(fs::read_to_string(item.path()).unwrap());
        }
    }
    for value in written.into_inner().unwrap() {
        assert!(kept.contains(&value), "{value} was lost");
    }
    for i in 0..4 {
        assert_eq!(fs::read_to_string(root.join(format!("manuscript/00{}-p.json", i + 2))).unwrap(), "p");
    }
    assert!(temp_files(root).is_empty(), "{:?}", temp_files(root));
    // Several snapshots were taken in the same minute: each one has its own file.
    let made = snapshots_made.into_inner().unwrap();
    assert_eq!(book_snapshots::list_book_snapshots(root).unwrap().len(), made, "a snapshot was overwritten by another one");
}

#[test]
fn concurrent_book_snapshots_in_the_same_minute_each_keep_their_own_file() {
    let d = book();
    write_file(d.path(), PAGE, "text", None).unwrap();
    let root = d.path();
    std::thread::scope(|s| {
        for i in 0..8 {
            s.spawn(move || book_snapshots::create_book_snapshot(root, &format!("n{i}"), at(2026, 3, 3, 3, 3)).unwrap());
        }
    });
    let listed = book_snapshots::list_book_snapshots(root).unwrap();
    assert_eq!(listed.len(), 8, "{listed:?}");
    let names: HashSet<_> = listed.iter().map(|e| e.name.clone()).collect();
    assert_eq!(names.len(), 8, "every name survived");
}

#[test]
fn concurrent_conflict_copies_in_the_same_minute_each_keep_their_own_file() {
    let d = book();
    write_file(d.path(), PAGE, "disk", None).unwrap();
    let root = d.path();
    std::thread::scope(|s| {
        for i in 0..5 {
            s.spawn(move || {
                // Each save thinks it saw a different earlier text, so each keeps what is on disk as a conflict copy.
                write_file(root, PAGE, &format!("mine-{i}"), Some(&hash_bytes(format!("old-{i}").as_bytes()))).unwrap();
            });
        }
    });
    let copies: Vec<_> = fs::read_dir(root.join("manuscript")).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains(".conflict-")).collect();
    assert_eq!(copies.len(), 5, "one copy per conflicting save");
    let texts: HashSet<String> = copies.iter().map(|e| fs::read_to_string(e.path()).unwrap()).collect();
    assert!(texts.contains("disk"));
    assert_eq!(texts.len(), 5, "the first text on disk and every later one are all kept");
}

// ---- 9. clock edges ----------------------------------------------------------------------------------------------

#[test]
fn two_book_snapshots_in_one_minute_both_exist_and_the_second_is_numbered() {
    let d = book();
    write_file(d.path(), PAGE, "text", None).unwrap();
    let now = at(2026, 5, 5, 5, 5);
    let a = book_snapshots::create_book_snapshot(d.path(), "a", now).unwrap();
    let b = book_snapshots::create_book_snapshot(d.path(), "b", now).unwrap();
    let c = book_snapshots::create_book_snapshot(d.path(), "c", now).unwrap();
    assert_eq!((a.path.as_str(), b.path.as_str(), c.path.as_str()), (".cadabra/snapshots/20260505-0505.json", ".cadabra/snapshots/20260505-0505~2.json", ".cadabra/snapshots/20260505-0505~3.json"));
    let names: Vec<String> = book_snapshots::list_book_snapshots(d.path()).unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(names, ["c", "b", "a"], "newest first within the minute");
}

#[test]
fn page_snapshots_taken_in_one_minute_never_replace_each_other() {
    let d = book();
    let now = at(2026, 5, 5, 5, 5);
    for text in ["one", "two", "three"] {
        let r = snapshots::keep_before_overwrite(d.path(), PAGE, text.as_bytes(), b"next", SnapshotMode::Always, now).unwrap();
        assert!(r.is_some(), "{text}");
    }
    let listed = snapshots::list_snapshots(d.path(), PAGE).unwrap();
    assert_eq!(listed.len(), 3);
    let mut texts: Vec<String> = listed.iter().map(|e| fs::read_to_string(d.path().join(&e.path)).unwrap()).collect();
    texts.sort();
    assert_eq!(texts, ["one", "three", "two"]);
}

#[test]
fn clocks_before_1970_and_far_in_the_future_never_panic_and_still_list_in_order() {
    let d = book();
    write_file(d.path(), PAGE, "text", None).unwrap();
    for (label, now) in [("1969", at(1969, 7, 20, 20, 17)), ("1900", at(1900, 1, 1, 0, 0)), ("year 1", at(1, 1, 1, 0, 0)), ("9999", at(9999, 12, 31, 23, 59)), ("epoch", DateTime::from_timestamp(0, 0).unwrap())] {
        let made = book_snapshots::create_book_snapshot(d.path(), label, now).unwrap();
        assert!(d.path().join(&made.path).is_file(), "{label}");
        let page_snap = snapshots::keep_before_overwrite(d.path(), PAGE, label.as_bytes(), b"next", SnapshotMode::Always, now).unwrap();
        assert!(page_snap.is_some_and(|p| d.path().join(p).is_file()), "{label}");
        snapshots::prune(d.path(), &[PAGE.to_string()], 1, now).unwrap();
    }
    let listed = book_snapshots::list_book_snapshots(d.path()).unwrap();
    assert_eq!(listed.len(), 5, "every one of them is listed");
    let stamps: Vec<&str> = listed.iter().map(|e| e.at.as_str()).collect();
    assert_eq!(stamps.first(), Some(&"99991231-2359"), "newest first");
    assert_eq!(stamps.last(), Some(&"00010101-0000"), "oldest last");
    // With "now" at year 9999 everything older than 30 days is prunable page history; with "now" in 1969 nothing is.
    let kept = snapshots::list_snapshots(d.path(), PAGE).unwrap().len();
    assert!(kept >= 1);
    assert_eq!(snapshots::prune(d.path(), &[PAGE.to_string()], 1, at(1969, 1, 1, 0, 0)).unwrap(), 0, "nothing is 30 days old to a clock that is earlier than all of it");
    assert!(book_snapshots::prune_book_snapshots(d.path(), &listed[0].path, 1, u64::MAX, at(1969, 1, 1, 0, 0)).len() <= listed.len());
}

#[test]
fn the_extreme_clock_values_of_the_date_library_do_not_panic() {
    let d = book();
    write_file(d.path(), PAGE, "text", None).unwrap();
    for now in [DateTime::<Utc>::MIN_UTC, DateTime::<Utc>::MAX_UTC] {
        let r = book_snapshots::create_book_snapshot(d.path(), "extreme", now);
        let s = snapshots::keep_before_overwrite(d.path(), PAGE, b"old", b"new", SnapshotMode::Throttled, now);
        // The stamp of such a year has a sign or five digits, so it is not a name this app lists; the call itself must still be
        // a plain answer, and anything it wrote must be a whole file.
        assert!(r.is_ok() || r.is_err());
        assert!(s.is_ok() || s.is_err());
        let _ = book_snapshots::list_book_snapshots(d.path());
        let _ = snapshots::prune(d.path(), &[PAGE.to_string()], 1, now);
        let _ = snapshots::find_stale(d.path(), &[PAGE.to_string()]);
    }
    assert!(temp_files(d.path()).is_empty());
}

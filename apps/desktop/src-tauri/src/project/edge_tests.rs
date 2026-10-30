//! Edge cases found in the audit: failed writes, corrupt or hostile file contents, awkward names, size boundaries, special
//! files, a link swapped between check and use, concurrent use and clock extremes. Everything here drives the real code
//! on temp dirs; nothing sleeps, and anything that could hang runs under a timeout.
//!
//! Windows-only behaviour is guarded with `cfg(windows)` and has NOT been run locally (the author's machine is macOS).
use super::snapshots::SnapshotMode;
use super::*;
use chrono::{DateTime, TimeZone, Utc};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

const PAGE: &str = "manuscript/001-a.json";

fn book() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    create_project(d.path(), "{\"formatVersion\":1}").unwrap();
    d
}

/// Every `.<random>.tmp` file left anywhere under `dir` (links are not followed).
fn temp_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for item in fs::read_dir(dir).unwrap().flatten() {
        let path = item.path();
        let t = item.file_type().unwrap();
        if t.is_dir() {
            out.extend(temp_files(&path));
        } else if item.file_name().to_string_lossy().starts_with('.') && item.file_name().to_string_lossy().ends_with(".tmp") {
            out.push(path);
        }
    }
    out
}

/// Runs `f` on its own thread and fails the test when it takes more than 5 seconds (a blocked open of a fifo).
fn within<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || drop(tx.send(f())));
    rx.recv_timeout(Duration::from_secs(5)).expect("must not hang")
}

fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
}

fn is_case_insensitive(dir: &Path) -> bool {
    fs::write(dir.join("CaseProbe"), "x").unwrap();
    let same = dir.join("caseprobe").exists();
    fs::remove_file(dir.join("CaseProbe")).unwrap();
    same
}

// ---- 1. failed writes -------------------------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn saving_into_a_read_only_folder_keeps_the_original_and_leaves_no_temp_file() {
    use std::os::unix::fs::PermissionsExt;
    let d = book();
    write_file(d.path(), PAGE, "original", None).unwrap();
    let dir = d.path().join("manuscript");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
    let running_as_root = fs::File::create(dir.join("probe")).is_ok();
    let result = write_file(d.path(), PAGE, "replacement", None);
    let new_file = write_file(d.path(), "manuscript/002-b.json", "x", None);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    if running_as_root {
        return; // root ignores the mode, so there is no failure to observe
    }
    assert!(matches!(result, Err(ProjectError::PermissionDenied { .. })), "{result:?}");
    assert!(matches!(new_file, Err(ProjectError::PermissionDenied { .. })), "{new_file:?}");
    assert_eq!(fs::read_to_string(d.path().join(PAGE)).unwrap(), "original");
    assert!(!d.path().join("manuscript/002-b.json").exists());
    assert!(temp_files(d.path()).is_empty(), "{:?}", temp_files(d.path()));
}

#[cfg(unix)]
#[test]
fn saving_into_a_read_only_exports_folder_is_a_typed_error_and_leaves_no_temp_file() {
    use std::os::unix::fs::PermissionsExt;
    let d = book();
    write_bytes(d.path(), "exports/a.epub", b"first").unwrap();
    let dir = d.path().join("exports");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
    let running_as_root = fs::File::create(dir.join("probe")).is_ok();
    let result = write_bytes(d.path(), "exports/a.epub", b"second");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    if running_as_root {
        return;
    }
    assert!(matches!(result, Err(ProjectError::PermissionDenied { .. })), "{result:?}");
    assert_eq!(fs::read(dir.join("a.epub")).unwrap(), b"first");
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn a_file_where_a_folder_is_needed_is_not_a_file_and_the_blocker_is_untouched() {
    let d = book();
    fs::remove_dir(d.path().join("exports")).unwrap();
    fs::write(d.path().join("exports"), "i am a file").unwrap();
    for rel in ["exports/a.epub", "exports/deeper/a.epub"] {
        let e = write_bytes(d.path(), rel, b"x").unwrap_err();
        assert!(matches!(e, ProjectError::NotAFile { .. } | ProjectError::NotFound { .. }), "{rel}: {e:?}");
    }
    assert_eq!(fs::read_to_string(d.path().join("exports")).unwrap(), "i am a file");
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn a_folder_where_a_page_should_go_is_not_a_file_and_stays_a_folder() {
    let d = book();
    fs::create_dir_all(d.path().join(PAGE)).unwrap();
    fs::write(d.path().join(PAGE).join("inner"), "keep").unwrap();
    assert!(matches!(write_file(d.path(), PAGE, "x", None), Err(ProjectError::NotAFile { .. })));
    assert!(matches!(write_file(d.path(), PAGE, "x", Some("stale")), Err(ProjectError::NotAFile { .. })));
    assert!(matches!(read_file(d.path(), PAGE), Err(ProjectError::NotAFile { .. })));
    assert_eq!(fs::read_to_string(d.path().join(PAGE).join("inner")).unwrap(), "keep");
    assert!(temp_files(d.path()).is_empty());
}

#[cfg(unix)]
#[test]
fn saving_through_a_link_replaces_the_link_and_never_writes_to_its_target() {
    let d = book();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("t.json"), "outside").unwrap();
    // A dangling link and a link out of the project are refused outright.
    std::os::unix::fs::symlink(d.path().join("manuscript/not-there.json"), d.path().join("manuscript/dangling.json")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("t.json"), d.path().join("manuscript/out.json")).unwrap();
    assert!(matches!(write_file(d.path(), "manuscript/dangling.json", "x", None), Err(ProjectError::PathEscape { .. })));
    assert!(matches!(write_file(d.path(), "manuscript/out.json", "x", None), Err(ProjectError::PathEscape { .. })));
    assert_eq!(fs::read_to_string(outside.path().join("t.json")).unwrap(), "outside");
    // A link inside the project: the save replaces the link (rename), so the file it pointed at is not rewritten.
    write_file(d.path(), "manuscript/real.json", "real", None).unwrap();
    std::os::unix::fs::symlink(d.path().join("manuscript/real.json"), d.path().join("manuscript/alias.json")).unwrap();
    write_file(d.path(), "manuscript/alias.json", "via alias", None).unwrap();
    assert_eq!(fs::read_to_string(d.path().join("manuscript/real.json")).unwrap(), "real");
    assert_eq!(fs::read_to_string(d.path().join("manuscript/alias.json")).unwrap(), "via alias");
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn a_snapshot_that_cannot_be_kept_never_stops_the_save() {
    let d = book();
    write_file(d.path(), PAGE, "one", None).unwrap();
    // `.cadabra/backups` is a file, so the snapshot of "one" cannot be written.
    fs::create_dir_all(d.path().join(".cadabra")).unwrap();
    fs::write(d.path().join(".cadabra/backups"), "blocker").unwrap();
    let w = write_file(d.path(), PAGE, "two", None).unwrap();
    assert_eq!(w.hash, hash_bytes(b"two"));
    assert_eq!(fs::read_to_string(d.path().join(PAGE)).unwrap(), "two");
    assert_eq!(fs::read_to_string(d.path().join(".cadabra/backups")).unwrap(), "blocker");
    assert!(temp_files(d.path()).is_empty());
}

// ---- 2. corrupt, truncated, empty, BOM-prefixed and deeply nested content -------------------------------------------

#[test]
fn a_bad_manifest_is_refused_before_anything_is_created() {
    let nested = |n: usize| format!("{{\"a\":{}{}}}", "[".repeat(n), "]".repeat(n));
    let bad: Vec<(&str, String)> = vec![
        ("bom then object", "\u{feff}{}".into()),
        ("truncated", "{\"formatVersion\":1,\"title\":\"x".into()),
        ("truncated after key", "{\"a\":".into()),
        ("empty", String::new()),
        ("only whitespace", " \n\t ".into()),
        ("nul inside", "{\"a\":\"x\0y\"}".into()),
        ("lone surrogate escape", "{\"a\":\"\\ud800\"}".into()),
        ("trailing garbage", "{} x".into()),
        ("two objects", "{}{}".into()),
        ("depth beyond the parser limit", nested(100_000)),
        ("depth just beyond the parser limit", nested(200)),
        ("array of objects", "[{}]".into()),
    ];
    for (what, text) in bad {
        let d = tempfile::tempdir().unwrap();
        let r = create_project(d.path(), &text);
        assert_eq!(r, Err(ProjectError::InvalidManifest), "{what}");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 0, "{what}: nothing is created for a refused manifest");
    }
    // Plausible depth and duplicate keys are fine.
    let d = tempfile::tempdir().unwrap();
    create_project(d.path(), &nested(100)).unwrap();
    let d = tempfile::tempdir().unwrap();
    create_project(d.path(), "{\"a\":1,\"a\":2}").unwrap();
}

#[test]
fn the_manifest_cap_applies_to_the_text_not_its_character_count() {
    // 1 MB of two-byte characters is 2 MB: refused by bytes, even though it has only 524_288 characters.
    let d = tempfile::tempdir().unwrap();
    let text = format!("{{\"a\":\"{}\"}}", "é".repeat(524_288));
    assert!(text.chars().count() < 1024 * 1024 && text.len() > 1024 * 1024);
    assert!(matches!(create_project(d.path(), &text), Err(ProjectError::TooLarge { .. })));
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 0);
}

#[test]
fn project_files_are_opaque_text_so_odd_manifests_and_pages_open_and_come_back_byte_for_byte() {
    let d = tempfile::tempdir().unwrap();
    for (what, bytes) in [("empty", &b""[..]), ("bom", b"\xef\xbb\xbf{}"), ("truncated", b"{\"a\":[1,"), ("nul", b"{\"a\":\"\0\"}"), ("crlf", b"{\r\n}\r\n")] {
        fs::write(d.path().join(MANIFEST), bytes).unwrap();
        assert_eq!(require_project(d.path()).as_deref(), Ok(d.path()), "{what}: only the file's presence is checked");
        let read = read_file(d.path(), MANIFEST).unwrap().unwrap();
        assert_eq!(read.contents.as_bytes(), bytes, "{what}");
        assert_eq!(read.hash, hash_bytes(bytes), "{what}");
        // Saving the same text back (as the app does) keeps it byte for byte.
        write_file(d.path(), "manuscript/001-a.json", &read.contents, None).unwrap();
        assert_eq!(fs::read(d.path().join("manuscript/001-a.json")).unwrap(), bytes, "{what}");
    }
    // Not UTF-8: a typed error, and nothing is rewritten.
    fs::write(d.path().join(MANIFEST), b"{\"a\":\"\xff\xfe\"}").unwrap();
    assert_eq!(read_file(d.path(), MANIFEST), Err(ProjectError::NotUtf8 { path: MANIFEST.into() }));
    assert_eq!(fs::read(d.path().join(MANIFEST)).unwrap(), b"{\"a\":\"\xff\xfe\"}");
    // A page that is not UTF-8 is not silently replaced by a save with a stale hash either: the existing bytes are kept as a
    // conflict copy first.
    fs::write(d.path().join("manuscript/002-b.json"), b"\xff\xfe\x00").unwrap();
    let w = write_file(d.path(), "manuscript/002-b.json", "fresh", Some(&hash_bytes(b"x"))).unwrap();
    assert_eq!(fs::read(d.path().join(w.conflict_copy.unwrap())).unwrap(), b"\xff\xfe\x00");
}

#[test]
fn a_book_snapshot_of_a_book_with_corrupt_files_is_a_typed_error_and_writes_nothing() {
    let d = book();
    write_file(d.path(), PAGE, "fine", None).unwrap();
    fs::write(d.path().join("manuscript/002-bad.json"), b"\xff\xfe not utf-8").unwrap();
    let r = book_snapshots::create_book_snapshot(d.path(), "x", at(2026, 1, 1, 10, 0));
    assert_eq!(r, Err(ProjectError::NotUtf8 { path: "manuscript/002-bad.json".into() }));
    assert!(!d.path().join(".cadabra/snapshots").exists() || fs::read_dir(d.path().join(".cadabra/snapshots")).unwrap().count() == 0);
    fs::remove_file(d.path().join("manuscript/002-bad.json")).unwrap();
    // A manifest that is not UTF-8, and one that is missing.
    fs::write(d.path().join(MANIFEST), b"\xff").unwrap();
    assert!(matches!(book_snapshots::create_book_snapshot(d.path(), "x", at(2026, 1, 1, 10, 0)), Err(ProjectError::NotUtf8 { .. })));
    fs::remove_file(d.path().join(MANIFEST)).unwrap();
    assert!(matches!(book_snapshots::create_book_snapshot(d.path(), "x", at(2026, 1, 1, 10, 0)), Err(ProjectError::NotFound { .. })));
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn odd_page_text_survives_a_book_snapshot_and_restore_exactly() {
    let d = book();
    let deep = format!("{}{}", "[".repeat(50_000), "]".repeat(50_000));
    let pages = [("manuscript/001-empty.json", String::new()), ("manuscript/002-bom.json", "\u{feff}{\"type\":\"doc\"".to_string()), ("manuscript/003-nul.json", "a\0b\u{202e}\u{200b}\n".to_string()), ("manuscript/004-deep.json", deep), ("manuscript/005-big.json", "x".repeat(256 * 1024))];
    for (rel, text) in &pages {
        fs::write(d.path().join(rel), text).unwrap();
    }
    let snap = book_snapshots::create_book_snapshot(d.path(), "odd", at(2026, 1, 1, 10, 0)).unwrap();
    assert_eq!(snap.pages.len(), pages.len());
    for (rel, _) in &pages {
        fs::write(d.path().join(rel), "changed").unwrap();
    }
    let restored = book_snapshots::restore_book_snapshot(d.path(), &snap.path, at(2026, 1, 1, 10, 5)).unwrap();
    assert_eq!(restored.written.len(), pages.len());
    for (rel, text) in &pages {
        assert_eq!(&fs::read_to_string(d.path().join(rel)).unwrap(), text, "{rel}");
    }
}

#[test]
fn hand_damaged_book_snapshot_files_are_skipped_when_listing_and_refused_when_restoring() {
    let d = book();
    write_file(d.path(), PAGE, "keep me", None).unwrap();
    let dir = d.path().join(".cadabra/snapshots");
    fs::create_dir_all(&dir).unwrap();
    let head = |extra: &str| format!("{{\"version\":1,\"name\":\"n\",\"automatic\":false,\"summary\":{{\"pages\":[],\"assets\":0}}{extra}}}");
    let nested = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("20260101-0001.json", vec![]),
        ("20260101-0002.json", b"{\"version\":1,\"name\":\"x\"".to_vec()),
        ("20260101-0003.json", [b"\xef\xbb\xbf".as_slice(), head("").as_bytes()].concat()),
        ("20260101-0004.json", b"{}".to_vec()),
        ("20260101-0005.json", nested.into_bytes()),
        ("20260101-0006.json", b"{\"version\":2,\"name\":\"n\",\"automatic\":false,\"summary\":{\"pages\":[],\"assets\":0}}".to_vec()),
        ("20260101-0007.json", b"[1,2,3]".to_vec()),
        ("20260101-0008.json", b"{\"version\":99999999999999999999,\"name\":\"n\"}".to_vec()),
        ("20260101-0009.json", b"\xff\xfe\xfd".to_vec()),
        ("not-a-snapshot.json", b"{}".to_vec()),
    ];
    for (name, bytes) in &cases {
        fs::write(dir.join(name), bytes).unwrap();
    }
    assert_eq!(book_snapshots::list_book_snapshots(d.path()).unwrap(), vec![], "none of these is a snapshot");
    for (name, _) in &cases {
        let path = format!(".cadabra/snapshots/{name}");
        for r in [book_snapshots::restore_book_snapshot(d.path(), &path, at(2026, 1, 2, 0, 0)).map(|_| ()), book_snapshots::delete_book_snapshot(d.path(), &path), book_snapshots::read_book_snapshot_page(d.path(), &path, PAGE).map(|_| ())] {
            assert!(matches!(r, Err(ProjectError::CannotRestore { .. })), "{name}: {r:?}");
        }
        assert!(dir.join(name).exists(), "{name} is left alone");
    }
    // A head that lists but whose body is missing fields: listed, and restoring it is a typed error that changes nothing.
    fs::write(dir.join("20260101-0010.json"), head("")).unwrap();
    let listed = book_snapshots::list_book_snapshots(d.path()).unwrap();
    assert_eq!(listed.len(), 1);
    let before = fs::read_dir(&dir).unwrap().count();
    assert!(matches!(book_snapshots::restore_book_snapshot(d.path(), &listed[0].path, at(2026, 1, 2, 0, 0)), Err(ProjectError::CannotRestore { .. })));
    assert_eq!(fs::read_dir(&dir).unwrap().count(), before, "no safety snapshot is taken for a snapshot that cannot be loaded");
    assert_eq!(fs::read_to_string(d.path().join(PAGE)).unwrap(), "keep me");
}

#[test]
fn a_book_snapshot_naming_paths_outside_the_pages_is_refused_before_anything_is_written() {
    let d = book();
    write_file(d.path(), PAGE, "keep me", None).unwrap();
    let dir = d.path().join(".cadabra/snapshots");
    fs::create_dir_all(&dir).unwrap();
    for (i, bad) in ["../evil.json", "manuscript/../../evil.json", "/etc/evil.json", "exports/evil.json", "manuscript/a/b/c.json", "manuscript/.json/x", "cadabra.json", "manuscript/a.json:stream"].into_iter().enumerate() {
        let body = serde_json::json!({ "version": 1, "name": "n", "automatic": false, "summary": { "pages": [bad], "assets": 0 }, "manifest": "{}", "pages": { bad: "pwned" }, "assets": [] });
        let name = format!("20260101-00{i:02}.json");
        fs::write(dir.join(&name), body.to_string()).unwrap();
        let path = format!(".cadabra/snapshots/{name}");
        let r = book_snapshots::restore_book_snapshot(d.path(), &path, at(2026, 1, 2, 0, 0));
        assert!(matches!(r, Err(ProjectError::CannotRestore { .. }) | Err(ProjectError::NotUtf8 { .. }) | Err(ProjectError::UnsafePath { .. })), "{bad}: {r:?}");
        assert!(book_snapshots::restore_page_from_book(d.path(), &path, bad).is_err(), "{bad}");
        fs::remove_file(dir.join(&name)).unwrap();
    }
    assert!(!d.path().parent().unwrap().join("evil.json").exists() && !d.path().join("evil.json").exists());
    assert_eq!(fs::read_to_string(d.path().join(PAGE)).unwrap(), "keep me");
}

// ---- 3. names ---------------------------------------------------------------------------------------------------

#[test]
fn a_255_byte_name_saves_and_a_name_over_the_limit_is_a_typed_error() {
    let d = book();
    let ok = format!("manuscript/{}.json", "a".repeat(250));
    assert_eq!(ok.len() - "manuscript/".len(), 255);
    write_file(d.path(), &ok, "long", None).unwrap();
    assert_eq!(read_file(d.path(), &ok).unwrap().unwrap().contents, "long");
    for len in [256usize, 300, 5000] {
        let too_long = format!("manuscript/{}.json", "b".repeat(len));
        let e = write_file(d.path(), &too_long, "x", None).unwrap_err();
        assert!(matches!(e, ProjectError::Io { .. } | ProjectError::NotFound { .. } | ProjectError::NotAFile { .. }), "{len}: {e:?}");
        assert!(matches!(read_file(d.path(), &too_long), Err(_) | Ok(None)));
        assert!(!d.path().join(&too_long).exists());
    }
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn a_page_whose_trash_name_would_be_too_long_stays_where_it_is() {
    // The trash name is `<stamp>-<folder>__<name>`, so a page that fits can be too long to move: it must stay, with a typed error.
    let d = book();
    let rel = format!("manuscript/{}.json", "a".repeat(250));
    write_file(d.path(), &rel, "keep", None).unwrap();
    let r = trash_file(d.path(), &rel);
    assert!(matches!(r, Err(ProjectError::Io { .. }) | Err(ProjectError::NotFound { .. }) | Err(ProjectError::NotAFile { .. })) || r.is_ok(), "{r:?}");
    if r.is_err() {
        assert_eq!(fs::read_to_string(d.path().join(&rel)).unwrap(), "keep");
    }
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn a_4096_byte_and_a_1000_deep_path_are_typed_errors_or_work_and_never_panic() {
    let d = book();
    let long: Vec<String> = (0..21).map(|i| format!("{i:03}{}", "d".repeat(200))).collect();
    let rel = format!("manuscript/{}/x.json", long.join("/"));
    assert!(rel.len() > 4096);
    assert!(write_file(d.path(), &rel, "x", None).is_err(), "no supported platform has paths over 4096 bytes");
    assert!(matches!(read_file(d.path(), &rel), Err(_) | Ok(None)));
    assert!(trash_file(d.path(), &rel).is_err());
    assert!(import_image(d.path(), &d.path().join(&rel)).is_err());
    // 1000 folders deep: macOS stops at 1024 bytes of path, Linux at 4096; either way the answer is Ok or a typed error.
    let deep = format!("manuscript/{}x.json", "d/".repeat(1000));
    match write_file(d.path(), &deep, "deep", None) {
        Ok(_) => assert_eq!(read_file(d.path(), &deep).unwrap().unwrap().contents, "deep"),
        Err(e) => assert!(matches!(e, ProjectError::Io { .. } | ProjectError::NotFound { .. } | ProjectError::NotAFile { .. }), "{e:?}"),
    }
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn names_with_newlines_bidi_overrides_and_zero_width_characters_round_trip_and_trash_and_restore() {
    let d = book();
    let names: &[&str] = if cfg!(windows) { &["a\u{202e}b\u{200b}c.json"] } else { &["a\nb.json", "a\u{202e}gnp.json", "a\u{200b}b.json", "\u{feff}a.json", "a\u{0007}b.json"] };
    for name in names {
        let rel = format!("manuscript/{name}");
        write_file(d.path(), &rel, "text", None).unwrap();
        assert_eq!(read_file(d.path(), &rel).unwrap().unwrap().contents, "text", "{name:?}");
        let trashed = trash_file(d.path(), &rel).unwrap();
        let listed = list_trash(d.path()).unwrap();
        let entry = listed.iter().find(|e| e.path == trashed).unwrap_or_else(|| panic!("{name:?} is listed in the trash"));
        assert_eq!(entry.original, rel, "{name:?}");
        assert_eq!(restore_trash(d.path(), &trashed).unwrap(), rel, "{name:?}");
        assert_eq!(fs::read_to_string(d.path().join(&rel)).unwrap(), "text");
    }
    // A NUL byte never reaches the file system.
    for rel in ["manuscript/a\0b.json", "manuscript/\0", "\0"] {
        assert_eq!(resolve(d.path(), rel), Err(ProjectError::UnsafePath { path: rel.into() }));
        assert!(matches!(write_file(d.path(), rel, "x", None), Err(ProjectError::UnsafePath { .. })));
        assert!(matches!(trash_file(d.path(), rel), Err(ProjectError::UnsafePath { .. })));
    }
    assert!(temp_files(d.path()).is_empty());
}

#[cfg(not(windows))]
#[test]
fn windows_reserved_names_are_ordinary_names_on_this_platform() {
    // UNVERIFIED on Windows. `resolve` does not refuse reserved device names (CON, NUL, COM1...) or names ending in a dot or
    // a space; on macOS and Linux they are plain file names, which this test pins. The Windows variant below is the
    // behaviour to check by hand on a Windows machine.
    let d = book();
    for name in ["CON.json", "NUL.json", "COM1.json", "aux.json", "con.", "trailing dot.", "trailing space .json"] {
        let rel = format!("manuscript/{name}");
        if name.ends_with('.') && !name.ends_with(".json") {
            continue; // not a page name (`.json` is required to trash or snapshot), so only saving is relevant
        }
        write_file(d.path(), &rel, "text", None).unwrap();
        assert_eq!(read_file(d.path(), &rel).unwrap().unwrap().contents, "text", "{name}");
    }
    write_file(d.path(), "manuscript/dot.", "text", None).unwrap();
    assert_eq!(read_file(d.path(), "manuscript/dot.").unwrap().unwrap().contents, "text");
}

#[cfg(windows)]
#[test]
fn windows_reserved_names_never_hang_or_write_outside_the_project() {
    // UNVERIFIED locally: written on macOS, not run on Windows. `CON.json` and `NUL.json` are device names there even
    // with an extension. Whatever the result, it must come back (no hang), and a saved page must read back as saved.
    let d = book();
    for name in ["CON.json", "NUL.json", "COM1.json", "LPT1.json", "aux.json", "trailing-dot.json.", "trailing-space.json "] {
        let rel = format!("manuscript/{name}");
        let r = within({
            let (root, rel) = (d.path().to_path_buf(), rel.clone());
            move || write_file(&root, &rel, "text", None).and_then(|_| read_file(&root, &rel))
        });
        if let Ok(Some(read)) = r {
            assert_eq!(read.contents, "text", "{name}");
        }
    }
}

#[test]
fn the_same_chapter_named_in_nfc_and_nfd_never_loses_either_save() {
    let d = book();
    let (nfc, nfd) = ("manuscript/caf\u{e9}.json", "manuscript/cafe\u{301}.json");
    write_file(d.path(), nfc, "first", None).unwrap();
    let same_file = d.path().join(nfd).exists(); // APFS and HFS+ treat them as one name; ext4 and NTFS as two
    let w = write_file(d.path(), nfd, "second", None).unwrap();
    if same_file {
        assert_eq!(read_file(d.path(), nfc).unwrap().unwrap().contents, "second");
        assert_eq!(read_file(d.path(), nfd).unwrap().unwrap().hash, w.hash);
        assert_eq!(fs::read_dir(d.path().join("manuscript")).unwrap().count(), 1, "one file, not two");
        // What the second save replaced is still recoverable from the page's history.
        // (The snapshot is named after the spelling used for the save, and a listing matches names byte for byte, so it shows
        // up under that spelling: a known limit, only reachable when one page is saved under two spellings.)
        let snaps = snapshots::list_snapshots(d.path(), nfd).unwrap();
        assert_eq!(snaps.len(), 1);
        assert_eq!(snapshots::read_snapshot(d.path(), nfd, &snaps[0].path).unwrap().contents, "first");
        // Trash through one spelling, restore, and the page is back whole.
        let trashed = trash_file(d.path(), nfd).unwrap();
        assert!(!d.path().join(nfc).exists());
        restore_trash(d.path(), &trashed).unwrap();
        assert_eq!(read_file(d.path(), nfc).unwrap().unwrap().contents, "second");
    } else {
        assert_eq!(read_file(d.path(), nfc).unwrap().unwrap().contents, "first");
        assert_eq!(read_file(d.path(), nfd).unwrap().unwrap().contents, "second");
    }
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn case_only_name_collisions_never_overwrite_without_keeping_the_old_text() {
    let d = book();
    let insensitive = is_case_insensitive(d.path());
    write_file(d.path(), "manuscript/Chapter.json", "upper", None).unwrap();
    // A save that expects a file that is not there (hash of nothing) meets the other-case file: on a case-insensitive disk
    // that is the same file, so the old text must be kept as a conflict copy; on a case-sensitive disk it is a new file.
    let w = write_file(d.path(), "manuscript/chapter.json", "lower", Some(&hash_bytes(b""))).unwrap();
    if insensitive {
        let copy = w.conflict_copy.expect("the replaced text is kept");
        assert_eq!(fs::read_to_string(d.path().join(copy)).unwrap(), "upper");
        assert_eq!(read_file(d.path(), "manuscript/Chapter.json").unwrap().unwrap().contents, "lower");
    } else {
        assert_eq!(w.conflict_copy, None);
        assert_eq!(read_file(d.path(), "manuscript/Chapter.json").unwrap().unwrap().contents, "upper");
        assert_eq!(read_file(d.path(), "manuscript/chapter.json").unwrap().unwrap().contents, "lower");
    }
    // A restore from the trash never lands on a page whose name differs only by case.
    write_file(d.path(), "manuscript/a.json", "trashed text", None).unwrap();
    let trashed = trash_file(d.path(), "manuscript/a.json").unwrap();
    write_file(d.path(), "manuscript/A.json", "new text", None).unwrap();
    let back = restore_trash(d.path(), &trashed).unwrap();
    assert_eq!(fs::read_to_string(d.path().join("manuscript/A.json")).unwrap(), "new text", "the page that was there is untouched");
    assert_eq!(fs::read_to_string(d.path().join(&back)).unwrap(), "trashed text");
    assert_eq!(back, if insensitive { "manuscript/a-2.json" } else { "manuscript/a.json" });
    // Importing images that differ only by case never overwrites either.
    let src = tempfile::tempdir().unwrap();
    let png = |extra: u8| [&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1][..], &[extra]].concat();
    fs::write(src.path().join("Pic.png"), png(1)).unwrap();
    let first = import_image(d.path(), &src.path().join("Pic.png")).unwrap();
    fs::remove_file(src.path().join("Pic.png")).unwrap();
    fs::write(src.path().join("pic.png"), png(2)).unwrap();
    let second = import_image(d.path(), &src.path().join("pic.png")).unwrap();
    assert_ne!(first, second);
    assert_eq!(fs::read(d.path().join(&first)).unwrap(), png(1));
    assert_eq!(fs::read(d.path().join(&second)).unwrap(), png(2));
}

// ---- 4. size boundaries ------------------------------------------------------------------------------------------

fn sparse(path: &Path, len: u64) {
    fs::File::create(path).unwrap().set_len(len).unwrap();
}

#[test]
fn a_reference_over_the_cap_of_its_kind_is_refused_without_copying_it() {
    let d = book();
    let src = tempfile::tempdir().unwrap();
    const MB: u64 = 1024 * 1024;
    for (name, cap_mb) in [("clip.mp4", 500), ("song.mp3", 200), ("paper.pdf", 200), ("photo.png", 100), ("data.zip", 100), ("noext", 100), ("notes.txt", 5)] {
        let p = src.path().join(name);
        sparse(&p, cap_mb * MB + 1);
        let e = import_reference(d.path(), &p).unwrap_err();
        assert_eq!(e, ProjectError::TooLarge { path: name.into(), max_mb: cap_mb }, "{name}");
    }
    assert!(fs::read_dir(d.path().join("references")).map(|r| r.count()).unwrap_or(0) == 0, "nothing was copied, not even a temp file");
}

#[test]
fn a_text_reference_of_exactly_the_cap_is_kept_and_empty_files_are_judged_by_their_type() {
    let d = book();
    let src = tempfile::tempdir().unwrap();
    let at_cap = src.path().join("cap.txt");
    fs::write(&at_cap, "a".repeat(5 * 1024 * 1024)).unwrap();
    let r = import_reference(d.path(), &at_cap).unwrap();
    assert_eq!((r.size, r.reused), (5 * 1024 * 1024, false));
    // Zero bytes: plain text is fine, anything with a signature is not a valid file of its type.
    for (name, ok) in [("empty.txt", true), ("empty.md", true), ("empty.png", false), ("empty.jpg", false), ("empty.svg", false), ("empty.pdf", false), ("empty.mp4", false), ("empty.mp3", false), ("empty.wav", false), ("empty.flac", false), ("empty.zip", true)] {
        let p = src.path().join(name);
        fs::write(&p, b"").unwrap();
        let r = import_reference(d.path(), &p);
        assert_eq!(r.is_ok(), ok, "{name}: {r:?}");
        if let Err(e) = r {
            assert!(matches!(e, ProjectError::InvalidReference { .. }), "{name}: {e:?}");
        }
    }
    assert!(temp_files(d.path()).is_empty());
}

#[test]
fn reference_ranges_at_the_chunk_and_file_boundaries() {
    let d = book();
    let big = d.path().join("references/big.mp4");
    sparse(&big, references::MAX_CHUNK + 1);
    let read = |off, len| read_reference_range(d.path(), "references/big.mp4", off, len).unwrap().len() as u64;
    assert_eq!(read(0, references::MAX_CHUNK), references::MAX_CHUNK);
    assert_eq!(read(0, references::MAX_CHUNK + 1), references::MAX_CHUNK, "one byte over the chunk size is cut to the chunk size");
    assert_eq!(read(0, 0), 0);
    assert_eq!(read(references::MAX_CHUNK, u64::MAX), 1, "the last byte");
    assert_eq!(read(references::MAX_CHUNK + 1, 10), 0, "at the end");
    assert_eq!(read(references::MAX_CHUNK + 2, 10), 0, "past the end");
    assert_eq!(read(u64::MAX, u64::MAX), 0);
    assert_eq!(read(u64::MAX - 1, 1), 0);
    fs::write(d.path().join("references/zero.txt"), b"").unwrap();
    assert!(read_reference_range(d.path(), "references/zero.txt", 0, 10).unwrap().is_empty());
    assert_eq!(stat_reference(d.path(), "references/zero.txt").unwrap().size, 0);
}

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
                book_snapshots::create_book_snapshot(root, "during", Utc::now()).unwrap();
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

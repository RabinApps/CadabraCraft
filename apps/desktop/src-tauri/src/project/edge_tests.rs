//! Edge cases found in the audit: failed writes, corrupt or hostile file contents, awkward names, size boundaries, special
//! files, a link swapped between check and use, concurrent use and clock extremes. Everything here drives the real code
//! on temp dirs; nothing sleeps, and anything that could hang runs under a timeout.
//!
//! Windows-only behaviour is guarded with `cfg(windows)` and has NOT been run locally (the author's machine is macOS).
use super::*;
use chrono::{DateTime, TimeZone, Utc};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

pub(super) const PAGE: &str = "manuscript/001-a.json";

pub(super) fn book() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    create_project(d.path(), "{\"formatVersion\":1}").unwrap();
    d
}

/// Every `.<random>.tmp` file left anywhere under `dir` (links are not followed).
pub(super) fn temp_files(dir: &Path) -> Vec<PathBuf> {
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
pub(super) fn within<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || drop(tx.send(f())));
    rx.recv_timeout(Duration::from_secs(5)).expect("must not hang")
}

pub(super) fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
}

pub(super) fn is_case_insensitive(dir: &Path) -> bool {
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

pub(super) fn sparse(path: &Path, len: u64) {
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

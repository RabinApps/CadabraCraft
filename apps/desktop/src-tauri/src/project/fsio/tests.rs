use super::*;
use crate::project::*;

/// A reader that claims nothing and yields `n` bytes, to stand for a file that grew after its size was read.
fn bytes_of(n: usize) -> std::io::Cursor<Vec<u8>> {
    std::io::Cursor::new(vec![7; n])
}

struct Broken;
impl Read for Broken {
    fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
        Err(std::io::Error::other("disk gone"))
    }
}

#[test]
fn a_capped_read_returns_the_bytes_of_a_regular_file_within_the_cap() {
    assert_eq!(read_capped(&mut bytes_of(4), true, 4, 4).unwrap(), vec![7; 4]);
    assert_eq!(read_capped(&mut bytes_of(0), true, 0, 4).unwrap(), Vec::<u8>::new());
}

#[test]
fn a_capped_read_refuses_a_file_that_stopped_being_regular_or_is_too_large() {
    assert!(matches!(read_capped(&mut bytes_of(1), false, 1, 4), Err(CappedError::NotAFile)));
    assert!(matches!(read_capped(&mut bytes_of(5), true, 5, 4), Err(CappedError::TooLarge)));
}

#[test]
fn a_capped_read_stops_a_file_that_grew_after_its_size_was_read() {
    // The size said 2, but 100 bytes are there: refused after reading at most cap + 1.
    assert!(matches!(read_capped(&mut bytes_of(100), true, 2, 4), Err(CappedError::TooLarge)));
    let mut reader = bytes_of(100);
    let _ = read_capped(&mut reader, true, 2, 4);
    assert_eq!(reader.position(), 5);
    // Growing but still within the cap is fine.
    assert_eq!(read_capped(&mut bytes_of(4), true, 1, 4).unwrap().len(), 4);
}

#[test]
fn a_capped_failure_becomes_the_error_of_the_caller() {
    let big = || ProjectError::TooLarge { path: "p".into(), max_mb: 1 };
    let io = |e: std::io::Error| ProjectError::Io { message: e.to_string() };
    assert_eq!(CappedError::NotAFile.into_project("a.json", &big, &io), ProjectError::NotAFile { path: "a.json".into() });
    assert_eq!(CappedError::TooLarge.into_project("a.json", &big, &io), big());
    assert_eq!(CappedError::Io(std::io::Error::other("x")).into_project("a.json", &big, &io), ProjectError::Io { message: "x".into() });
}

#[test]
fn a_capped_read_reports_a_read_error() {
    assert!(matches!(read_capped(&mut Broken, true, 1, 4), Err(CappedError::Io(e)) if e.to_string() == "disk gone"));
}

#[test]
fn audio_parts_are_only_flac_files_directly_under_the_parts_folder() {
    for ok in [".cadabra/audio/parts/ch-1.flac", ".cadabra/audio/parts/a b.flac"] {
        assert!(is_audio_part(ok), "{ok}");
    }
    for bad in [
        ".cadabra/audio/parts/.flac",
        ".cadabra/audio/parts/x.wav",
        ".cadabra/audio/parts/sub/x.flac",
        ".cadabra/audio/x.flac",
        "exports/x.flac",
        ".cadabra/audio/parts/",
    ] {
        assert!(!is_audio_part(bad), "{bad}");
    }
    let d = tempfile::tempdir().unwrap();
    write_audio_part(d.path(), ".cadabra/audio/parts/c.flac", b"x").unwrap();
    assert_eq!(fs::read(d.path().join(".cadabra/audio/parts/c.flac")).unwrap(), b"x");
    assert!(write_audio_part(d.path(), "exports/c.flac", b"x").is_err());
    assert!(write_audio_part(d.path(), ".cadabra/audio/parts/../c.flac", b"x").is_err());
}
use std::path::Path;

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn atomic_write_replaces_and_leaves_no_temp() {
    let d = tmp();
    let p = d.path().join("a.json");
    atomic_write(&p, b"one").unwrap();
    atomic_write(&p, b"two").unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"two");
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
}

#[test]
fn atomic_write_uses_unique_temp_names_and_never_touches_foreign_temp_files() {
    let d = tmp();
    let p = d.path().join("a.json");
    fs::write(d.path().join(".a.json.tmp"), "someone else's").unwrap();
    atomic_write(&p, b"mine").unwrap();
    assert_eq!(fs::read(&p).unwrap(), b"mine");
    assert_eq!(fs::read_to_string(d.path().join(".a.json.tmp")).unwrap(), "someone else's");
}

#[test]
fn atomic_write_cleans_up_its_temp_file_on_failure() {
    let d = tmp();
    let target = d.path().join("taken");
    fs::create_dir(&target).unwrap(); // renaming a file over a directory fails
    assert!(atomic_write(&target, b"x").is_err());
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1, "only the directory is left");
}

#[cfg(unix)]
#[test]
fn atomic_write_keeps_the_mode_of_an_existing_file_and_defaults_to_0644() {
    use std::os::unix::fs::PermissionsExt;
    let d = tmp();
    let p = d.path().join("a.json");
    atomic_write(&p, b"1").unwrap();
    assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o644);
    fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
    atomic_write(&p, b"2").unwrap();
    assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
}

fn no_temp_files(dir: &Path) {
    let left: Vec<_> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".tmp")).collect();
    assert!(left.is_empty(), "leftover temp files in {}: {left:?}", dir.display());
}

#[test]
fn write_bytes_only_writes_under_exports() {
    let d = tmp();
    fs::create_dir_all(d.path().join("exports")).unwrap();
    for bad in [MANIFEST, "manuscript/ch1.json", "assets/a.png", "exports", "exports/", ".cadabra/x", "exportsx/a.pdf", "exports/../cadabra.json"] {
        assert!(matches!(write_bytes(d.path(), bad, b"x"), Err(ProjectError::UnsafePath { .. })), "{bad}");
    }
    assert!(!d.path().join(MANIFEST).exists());
    write_bytes(d.path(), "exports/book.epub", b"ok").unwrap();
    write_bytes(d.path(), "exports/sub/book.pdf", b"ok").unwrap();
    assert_eq!(fs::read(d.path().join("exports/sub/book.pdf")).unwrap(), b"ok");
}

#[test]
fn write_bytes_replaces_an_existing_export_and_keeps_no_temp() {
    let d = tmp();
    write_bytes(d.path(), "exports/book.pdf", b"first").unwrap();
    write_bytes(d.path(), "exports/book.pdf", b"second, longer").unwrap();
    write_bytes(d.path(), "exports/book.pdf", b"").unwrap(); // an empty file is a valid write
    assert_eq!(fs::read(d.path().join("exports/book.pdf")).unwrap(), b"");
    no_temp_files(&d.path().join("exports"));
}

#[test]
fn write_bytes_onto_a_directory_is_not_a_file_and_leaves_nothing_behind() {
    let d = tmp();
    fs::create_dir_all(d.path().join("exports/book.epub")).unwrap();
    fs::write(d.path().join("exports/book.epub/keep.txt"), "x").unwrap();
    assert_eq!(write_bytes(d.path(), "exports/book.epub", b"x").unwrap_err(), ProjectError::NotAFile { path: "book.epub".into() });
    assert!(d.path().join("exports/book.epub/keep.txt").exists());
    no_temp_files(&d.path().join("exports"));
}

#[test]
fn write_bytes_when_exports_is_a_file_is_not_a_file() {
    let d = tmp();
    fs::write(d.path().join("exports"), "i am a file").unwrap();
    assert_eq!(write_bytes(d.path(), "exports/book.epub", b"x").unwrap_err(), ProjectError::NotAFile { path: "exports".into() });
    assert_eq!(fs::read_to_string(d.path().join("exports")).unwrap(), "i am a file");
}

#[cfg(unix)]
#[test]
fn write_bytes_into_a_read_only_folder_is_permission_denied_and_leaves_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let d = tmp();
    let exports = d.path().join("exports");
    fs::create_dir_all(&exports).unwrap();
    fs::set_permissions(&exports, fs::Permissions::from_mode(0o555)).unwrap();
    let probe = fs::File::create(exports.join("probe"));
    let result = write_bytes(d.path(), "exports/book.epub", b"x");
    fs::set_permissions(&exports, fs::Permissions::from_mode(0o755)).unwrap();
    if probe.is_ok() {
        return; // running as root: permissions do not apply, so there is nothing to check
    }
    assert_eq!(result.unwrap_err(), ProjectError::PermissionDenied { path: "book.epub".into() });
    assert!(!exports.join("book.epub").exists());
    no_temp_files(&exports);
}

#[cfg(unix)]
#[test]
fn write_bytes_over_a_read_only_existing_file_replaces_it_and_keeps_its_mode() {
    use std::os::unix::fs::PermissionsExt;
    let d = tmp();
    write_bytes(d.path(), "exports/book.pdf", b"old").unwrap();
    fs::set_permissions(d.path().join("exports/book.pdf"), fs::Permissions::from_mode(0o444)).unwrap();
    write_bytes(d.path(), "exports/book.pdf", b"new").unwrap();
    assert_eq!(fs::read(d.path().join("exports/book.pdf")).unwrap(), b"new");
    assert_eq!(fs::metadata(d.path().join("exports/book.pdf")).unwrap().permissions().mode() & 0o777, 0o444);
    no_temp_files(&d.path().join("exports"));
}

#[cfg(unix)]
#[test]
fn write_bytes_never_follows_a_link_out_of_exports() {
    let d = tmp();
    let (proj, outside) = (d.path().join("p"), d.path().join("outside"));
    fs::create_dir_all(proj.join("exports")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(outside.join("victim.pdf"), proj.join("exports/book.pdf")).unwrap(); // dangling
    fs::write(outside.join("real.pdf"), "keep").unwrap();
    std::os::unix::fs::symlink(outside.join("real.pdf"), proj.join("exports/book.epub")).unwrap();
    assert!(matches!(write_bytes(&proj, "exports/book.pdf", b"x"), Err(ProjectError::PathEscape { .. })));
    assert!(matches!(write_bytes(&proj, "exports/book.epub", b"x"), Err(ProjectError::PathEscape { .. })));
    assert!(!outside.join("victim.pdf").exists());
    assert_eq!(fs::read_to_string(outside.join("real.pdf")).unwrap(), "keep");
}

#[test]
fn concurrent_writes_to_one_export_never_mix_or_leave_temp_files() {
    let d = tmp();
    let root = d.path().to_path_buf();
    let payloads: Vec<Vec<u8>> = (0u8..8).map(|i| vec![i; 64 * 1024 + usize::from(i) * 977]).collect();
    let handles: Vec<_> = payloads
        .iter()
        .cloned()
        .map(|p| {
            let root = root.clone();
            std::thread::spawn(move || {
                for _ in 0..15 {
                    write_bytes(&root, "exports/book.epub", &p).unwrap();
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let got = fs::read(root.join("exports/book.epub")).unwrap();
    assert!(payloads.contains(&got), "the file must be exactly one writer's bytes, not a mix");
    no_temp_files(&root.join("exports"));
}

#[cfg(unix)]
#[test]
fn atomic_write_reports_a_folder_it_may_not_create() {
    use std::os::unix::fs::PermissionsExt;
    let d = tmp();
    let ro = d.path().join("ro");
    fs::create_dir(&ro).unwrap();
    fs::set_permissions(&ro, fs::Permissions::from_mode(0o555)).unwrap();
    let denied = fs::File::create(ro.join("probe")).is_err(); // false when running as root
    let result = atomic_write(&ro.join("sub/page.json"), b"x");
    fs::set_permissions(&ro, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(!denied || result.unwrap_err() == ProjectError::PermissionDenied { path: "page.json".into() });
}

fn no_links(_: &Path, _: &Path) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

#[test]
fn rename_no_replace_moves_and_refuses_to_replace() {
    let d = tmp();
    let (a, b) = (d.path().join("a"), d.path().join("b"));
    fs::write(&a, "A").unwrap();
    rename_no_replace(&a, &b).unwrap();
    assert!(!a.exists());
    assert_eq!(fs::read_to_string(&b).unwrap(), "A");
    fs::write(&a, "new").unwrap();
    let e = rename_no_replace(&a, &b).unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!((fs::read_to_string(&a).unwrap(), fs::read_to_string(&b).unwrap()), ("new".into(), "A".into()));
}

#[test]
fn rename_no_replace_without_hard_links_falls_back_and_still_refuses_to_replace() {
    let d = tmp();
    let (a, b) = (d.path().join("a"), d.path().join("b"));
    fs::write(&a, "A").unwrap();
    rename_no_replace_with(&a, &b, no_links).unwrap();
    assert!(!a.exists() && fs::read_to_string(&b).unwrap() == "A");
    fs::write(&a, "new").unwrap();
    let e = rename_no_replace_with(&a, &b, no_links).unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(fs::read_to_string(&b).unwrap(), "A");
    // A missing source is reported, not swallowed.
    assert_eq!(rename_no_replace_with(&d.path().join("gone"), &d.path().join("c"), no_links).unwrap_err().kind(), std::io::ErrorKind::NotFound);
}

#[test]
fn a_failed_unlink_after_the_link_rolls_the_new_name_back() {
    let d = tmp();
    let (a, b) = (d.path().join("a"), d.path().join("b"));
    fs::write(&a, "A").unwrap();
    // The "link" makes the new name but also removes the source, so the unlink afterwards fails.
    let e = rename_no_replace_with(&a, &b, |from, to| {
        fs::copy(from, to)?;
        fs::remove_file(from)
    })
    .unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::NotFound);
    assert!(!b.exists());
}

#[test]
fn a_move_that_loses_the_race_for_a_name_uses_the_next_one() {
    let d = tmp();
    let src = d.path().join("page.json");
    fs::write(&src, "mine").unwrap();
    // free_name saw `t/x.json` free, but another writer creates it just before the move.
    let raced = std::cell::Cell::new(false);
    let got = move_to_free_name_with(d.path(), &src, "t/x.json", "x", free_name, |from, to| {
        if !raced.replace(true) {
            fs::write(to, "theirs").unwrap();
        }
        rename_no_replace(from, to)
    })
    .unwrap();
    assert_eq!(got, "t/x-2.json");
    assert_eq!(fs::read_to_string(d.path().join("t/x.json")).unwrap(), "theirs");
    assert_eq!(fs::read_to_string(d.path().join("t/x-2.json")).unwrap(), "mine");
    assert!(!src.exists());
}

#[test]
fn a_move_into_a_folder_that_is_really_a_file_fails_and_leaves_the_source() {
    let d = tmp();
    let src = d.path().join("p.json");
    fs::write(&src, "mine").unwrap();
    fs::write(d.path().join("t"), "i am a file").unwrap();
    assert!(move_to_free_name(d.path(), &src, "t/x.json", "x").is_err());
    assert_eq!(fs::read_to_string(&src).unwrap(), "mine");
}

#[test]
fn a_move_gives_up_after_a_bounded_number_of_races_and_reports_other_errors() {
    let d = tmp();
    let src = d.path().join("p.json");
    fs::write(&src, "mine").unwrap();
    let always = |_: &Path, _: &Path| Err(std::io::ErrorKind::AlreadyExists.into());
    assert!(move_to_free_name_with(d.path(), &src, "x.json", "x", free_name, always).is_err());
    let denied = |_: &Path, _: &Path| Err(std::io::ErrorKind::PermissionDenied.into());
    assert!(matches!(move_to_free_name_with(d.path(), &src, "y.json", "y", free_name, denied), Err(ProjectError::PermissionDenied { .. })));
    assert!(src.exists());
}

#[test]
fn syncing_a_missing_directory_is_ignored() {
    sync_dir(Path::new("/definitely/not/here"));
}

#[cfg(unix)]
#[test]
fn reading_a_regular_file_that_cannot_be_opened_is_permission_denied() {
    use std::os::unix::fs::PermissionsExt;
    let d = tmp();
    let p = d.path().join("locked.bin");
    fs::write(&p, b"x").unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o000)).unwrap();
    let too_large = || ProjectError::TooLarge { path: "locked.bin".into(), max_mb: 0 };
    let got = read_regular(&p, 10, "locked.bin", too_large);
    let big = d.path().join("big.bin");
    fs::write(&big, [0u8; 20]).unwrap();
    assert_eq!(read_regular(&big, 10, "locked.bin", too_large).unwrap_err(), too_large());
    let opened = fs::File::open(&p).is_ok();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();
    if opened {
        return; // running as root: permissions do not apply
    }
    assert_eq!(got.unwrap_err(), ProjectError::PermissionDenied { path: "locked.bin".into() });
}

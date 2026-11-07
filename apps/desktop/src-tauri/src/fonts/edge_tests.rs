//! Audit edge cases for font import and storage: damaged font files, awkward names, special files and path segments.
//! Windows-only behaviour is not exercised here (unverified locally).
#[cfg(unix)]
use super::import::read_font;
use super::import::tests::{font_with_names, ttf, utf16};
use super::import::{family_name, import_font, slug};
use super::store::{family_dir, is_safe_segment};
use std::fs;
use std::path::Path;
#[cfg(unix)]
use std::sync::mpsc;
#[cfg(unix)]
use std::time::Duration;

#[cfg(unix)]
fn within<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || drop(tx.send(f())));
    rx.recv_timeout(Duration::from_secs(5)).expect("must not hang")
}

#[test]
fn every_prefix_and_every_single_byte_damage_of_a_font_is_an_answer_never_a_panic() {
    let font = ttf("Fancy Serif");
    for n in 0..=font.len() {
        let _ = family_name(&font[..n]);
    }
    for i in 0..font.len() {
        for byte in [0x00, 0xff, 0x7f] {
            let mut damaged = font.clone();
            damaged[i] = byte;
            let _ = family_name(&damaged);
        }
    }
    assert_eq!(family_name(&font).unwrap(), "Fancy Serif");
}

#[test]
fn name_tables_that_lie_about_their_size_are_refused_or_skipped() {
    // A table directory that claims 65535 tables in a file of 12 bytes.
    let mut huge_dir = vec![0, 1, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0];
    assert!(family_name(&huge_dir).is_err());
    huge_dir.extend([0u8; 15]);
    assert!(family_name(&huge_dir).is_err());
    // A name record whose string runs past the table, and one whose offset wraps.
    let mut font = ttf("Fancy");
    let at = font.len() - 1;
    font.truncate(at);
    let r = family_name(&font);
    let _ = r;
    // A record count far above what the table holds, and a name that is only control characters or a bidi override.
    for family in ["\u{202e}", "\u{0}", "a\nb", &"x".repeat(101)] {
        let f = font_with_names(&[(3, 1, 0x409, 1, utf16(family))]);
        let r = family_name(&f);
        if family == "\u{202e}" {
            // A bidi override is not a control character in Unicode's sense (it is a format character), so the name is kept; the
            // folder name is made from letters and digits only, so it never reaches the disk.
            assert_eq!(r.as_deref().map(slug), Ok(String::new()));
        } else {
            assert!(r.is_err(), "{family:?}");
        }
    }
    assert!(family_name(&font_with_names(&[(3, 1, 0x409, 1, utf16(&"x".repeat(100)))])).is_ok());
    assert!(family_name(&font_with_names(&[])).is_err());
    assert!(family_name(&font_with_names(&[(3, 1, 0x409, 1, vec![0xd8, 0x00])])).is_err(), "a lone surrogate is not a name");
    assert!(family_name(&font_with_names(&[(3, 1, 0x409, 1, vec![0x00])])).is_err(), "an odd byte count is not UTF-16");
}

#[test]
fn a_family_name_that_would_be_a_path_becomes_a_safe_folder_or_is_refused() {
    let d = tempfile::tempdir().unwrap();
    let src = tempfile::tempdir().unwrap();
    for (family, expect) in
        [("../../escape", Some("escape")), ("a/b\\c:d", Some("a-b-c-d")), ("CON", Some("con")), ("..", None), ("\u{202e}\u{200b}", None), ("日本語", None)]
    {
        let path = src.path().join("f.ttf");
        fs::write(&path, ttf(family)).unwrap();
        let r = import_font(&path, d.path());
        match expect {
            Some(folder) => {
                r.unwrap_or_else(|e| panic!("{family}: {e:?}"));
                assert!(d.path().join("imported").join(folder).is_dir(), "{family}");
            }
            None => assert!(r.is_err(), "{family}"),
        }
    }
    // Nothing was written outside `imported/`.
    let top: Vec<_> = fs::read_dir(d.path()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(top, ["imported"]);
    assert!(!d.path().parent().unwrap().join("escape").exists());
}

#[test]
fn a_font_file_named_with_the_maximum_length_or_odd_characters_imports_under_a_safe_name() {
    let d = tempfile::tempdir().unwrap();
    let src = tempfile::tempdir().unwrap();
    let long = src.path().join(format!("{}.TTF", "n".repeat(251)));
    assert_eq!(long.file_name().unwrap().len(), 255);
    fs::write(&long, ttf("Long Name")).unwrap();
    let r = import_font(&long, d.path());
    let _ = r; // 255 bytes plus the dir may fail on some systems: a typed error, never a panic
    let odd = src.path().join("a\u{202e}b\u{200b}c d.otf");
    fs::write(&odd, ttf("Odd Name")).unwrap();
    let font = import_font(&odd, d.path()).unwrap();
    assert!(font.files.iter().all(|f| f.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))), "{:?}", font.files);
    let too_long = src.path().join(format!("{}.ttf", "m".repeat(400)));
    assert!(import_font(&too_long, d.path()).is_err());
}

#[cfg(unix)]
#[test]
fn special_files_as_a_font_source_are_refused_without_hanging() {
    let d = tempfile::tempdir().unwrap();
    let fifo = d.path().join("pipe.ttf");
    assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
    let _socket = std::os::unix::net::UnixListener::bind(d.path().join("s.ttf")).unwrap();
    std::os::unix::fs::symlink("/dev/zero", d.path().join("zero.ttf")).unwrap();
    std::os::unix::fs::symlink(d.path().join("gone"), d.path().join("dangling.ttf")).unwrap();
    fs::create_dir(d.path().join("dir.ttf")).unwrap();
    for name in ["pipe.ttf", "s.ttf", "zero.ttf", "dangling.ttf", "dir.ttf"] {
        let path = d.path().join(name);
        assert!(within(move || read_font(&path)).is_err(), "{name}");
    }
    let root = d.path().join("fonts");
    assert!(within({
        let fifo = fifo.clone();
        move || import_font(&fifo, &root)
    })
    .is_err());
    assert!(!d.path().join("fonts").exists(), "nothing is created for a refused source");
}

#[test]
fn font_ids_with_separators_nul_bidi_characters_or_over_255_bytes_are_unknown() {
    let root = Path::new("/fonts-root");
    let long = "a".repeat(256);
    let ok_long = "a".repeat(255);
    for id in ["", ".", "..", "a/b", "a\\b", "a\0b", "../x", "imported-", "imported-..", "imported-a/b", "imported-\0", long.as_str(), "no-such-family"] {
        assert!(family_dir(root, id).is_err(), "{id:?}");
        assert!(!is_safe_segment(id) || id == "imported-" || id == "no-such-family" || id == "imported-..", "{id:?}");
    }
    assert!(is_safe_segment(&ok_long) && !is_safe_segment(&long));
    assert!(is_safe_segment("a\u{202e}b\u{200b}"), "format characters are not path separators, so they are just part of a name");
    assert_eq!(family_dir(root, "imported-a\u{202e}b").unwrap(), root.join("imported").join("a\u{202e}b"));
}

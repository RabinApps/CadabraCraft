//! Audit edge cases for the import source readers: special files, awkward names and empty images. Windows-only behaviour
//! is not exercised here (unverified locally).
use super::*;
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

#[cfg(unix)]
#[test]
fn sockets_devices_folders_and_dangling_links_are_typed_errors_for_documents_and_images() {
    let d = tempfile::tempdir().unwrap();
    let p = |n: &str| d.path().join(n);
    let _socket_md = std::os::unix::net::UnixListener::bind(p("s.md")).unwrap();
    let _socket_png = std::os::unix::net::UnixListener::bind(p("s.png")).unwrap();
    std::os::unix::fs::symlink("/dev/null", p("null.md")).unwrap();
    std::os::unix::fs::symlink("/dev/zero", p("zero.md")).unwrap();
    std::os::unix::fs::symlink("/dev/zero", p("zero.png")).unwrap();
    std::os::unix::fs::symlink(p("gone"), p("dangling.md")).unwrap();
    std::os::unix::fs::symlink(p("gone"), p("dangling.png")).unwrap();
    for name in ["s.md", "null.md", "zero.md", "dangling.md"] {
        let path = p(name);
        let r = within(move || read_source(&path));
        assert!(matches!(r, Err(ProjectError::NotAFile { .. }) | Err(ProjectError::NotFound { .. })), "{name}: {r:?}");
    }
    let doc = p("book.md");
    for name in ["s.png", "zero.png", "dangling.png"] {
        let (doc, shown) = (doc.clone(), name.to_string());
        let r = within(move || read_relative_image(&doc, &shown));
        assert!(
            matches!(r, Err(ProjectError::NotAFile { .. } | ProjectError::ImageRefNotFound { .. } | ProjectError::ImageRefOutside { .. })),
            "{name}: {r:?}"
        );
    }
}

#[test]
fn names_at_and_over_the_file_name_limit_and_with_invisible_characters() {
    let d = tempfile::tempdir().unwrap();
    let ok = d.path().join(format!("{}.md", "a".repeat(252)));
    assert_eq!(ok.file_name().unwrap().len(), 255);
    fs::write(&ok, "hi").unwrap();
    assert_eq!(read_source(&ok).unwrap(), b"hi");
    let too_long = d.path().join(format!("{}.md", "b".repeat(300)));
    assert!(read_source(&too_long).is_err(), "a name over the limit is a typed error, not a panic");
    // Invisible and bidirectional characters after the extension make it a different, unsupported extension.
    for name in ["book.md\u{200b}", "book.md\u{202e}", "book\u{202e}dm.exe", "book.m\u{200d}d", "book.\u{feff}md"] {
        let path = d.path().join(name);
        fs::write(&path, "x").unwrap();
        assert!(matches!(read_source(&path), Err(ProjectError::UnsupportedDocument { .. })), "{name:?}");
    }
    // Invisible characters inside the stem are just part of the name.
    let odd = d.path().join("bo\u{200b}ok\u{202e}.md");
    fs::write(&odd, "x").unwrap();
    assert_eq!(read_source(&odd).unwrap(), b"x");
    assert!(read_source(Path::new("/")).is_err());
}

#[test]
fn an_empty_or_tiny_image_is_not_a_valid_image_and_a_reference_with_a_nul_never_touches_the_disk() {
    let d = tempfile::tempdir().unwrap();
    let md = d.path().join("book.md");
    for (name, bytes) in [("empty.png", &b""[..]), ("one.jpg", b"\xff"), ("short.gif", b"GIF8"), ("empty.svg", b""), ("riff.webp", b"RIFF")] {
        fs::write(d.path().join(name), bytes).unwrap();
        assert!(matches!(read_relative_image(&md, name), Err(ProjectError::InvalidImage { .. })), "{name}");
    }
    let huge = "x".repeat(1_000_000);
    for bad in ["a\0.png", "\0", "a/\0/b.png", huge.as_str()] {
        let e = read_relative_image(&md, bad).unwrap_err();
        let shown = serde_json::to_string(&e).unwrap();
        assert!(shown.len() < 400, "an error never echoes a megabyte reference back: {}", shown.len());
    }
}

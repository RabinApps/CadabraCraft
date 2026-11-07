//! Read-only access to files the user picked for import. Nothing here writes next to the source file.
//!
//! Text types are returned as raw bytes: BOMs, UTF-16 and invalid UTF-8 pass through untouched (the importer decodes).
//! Every failure is a typed `ProjectError` that names the file, never an absolute path.
use crate::project::{check_image, icloud_pending, image_ext, image_too_large, io_error, open_error, read_regular, ProjectError, MAX_IMAGE_BYTES};
use std::fs;
use std::path::{Component, Path, PathBuf};

type Result<T> = std::result::Result<T, ProjectError>;

/// Document types the importer understands: manuscripts and, for the outline import (parsed in the webview, so only read here), `opml` and `csv`.
pub const IMPORT_EXTENSIONS: [&str; 8] = ["docx", "md", "markdown", "html", "htm", "txt", "opml", "csv"];
/// Largest source document accepted, in bytes.
pub const MAX_IMPORT_BYTES: u64 = 200 * 1024 * 1024;

/// A path from the webview must be absolute: a relative one would resolve against wherever the app happens to run.
fn require_absolute(path: &Path) -> Result<()> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err(ProjectError::UnsafePath { path: path.file_name().map_or_else(|| path.to_string_lossy().into_owned(), |n| n.to_string_lossy().into_owned()) })
    }
}

/// Reads a document the user picked (absolute path). Only allowlisted extensions (ASCII case-insensitive, the last
/// extension only: `a.html.exe`, `.html`, `a.` and `a.md ` are refused), regular files, capped size. A link the user
/// picked is followed, but it must lead to a regular file; folders, fifos and devices are never opened.
pub fn read_source(path: &Path) -> Result<Vec<u8>> {
    require_absolute(path)?;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or(ProjectError::InvalidFileName)?;
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !IMPORT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(ProjectError::UnsupportedDocument { name: name.to_string() });
    }
    read_regular(path, MAX_IMPORT_BYTES, name, || ProjectError::TooLarge { path: name.to_string(), max_mb: MAX_IMPORT_BYTES / 1024 / 1024 })
}

/// Reads an image a Markdown file references, relative to that file's folder. Refuses absolute paths, `..`,
/// backslashes, colons (drive prefixes, `file:` URLs, NTFS streams), NUL, symlinks that lead outside the folder,
/// non-image extensions, oversized files, content that is not the claimed type and absurd pixel counts.
pub fn read_relative_image(source_file: &Path, reference: &str) -> Result<Vec<u8>> {
    require_absolute(source_file)?;
    let shown: String = reference.chars().take(80).collect();
    let rel = Path::new(reference);
    let safe =
        !reference.is_empty() && !reference.contains(['\\', ':', '\0']) && rel.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if !safe {
        return Err(ProjectError::ImageRefNotAllowed { reference: shown });
    }
    let ext = image_ext(reference).ok_or_else(|| ProjectError::UnsupportedImage { name: shown.clone() })?;
    let base: PathBuf = source_file.parent().ok_or(ProjectError::InvalidFileName)?.to_path_buf();
    let base = fs::canonicalize(&base).map_err(|e| open_error(e, &base, "the document folder"))?;
    let wanted = base.join(rel);
    let full = fs::canonicalize(&wanted).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => io_error(e, &shown),
        _ if icloud_pending(&wanted) => ProjectError::IcloudPending { path: shown.clone() },
        _ => ProjectError::ImageRefNotFound { reference: shown.clone() }, // missing, a loop, or a file where a folder should be
    })?;
    if !full.starts_with(&base) {
        return Err(ProjectError::ImageRefOutside { reference: shown });
    }
    let bytes = read_regular(&full, MAX_IMAGE_BYTES, &shown, || image_too_large(&shown))?;
    check_image(&shown, &ext, &bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

    #[test]
    fn reads_allowed_sources_and_leaves_them_untouched() {
        let d = tempfile::tempdir().unwrap();
        for n in ["a.docx", "b.MD", "c.markdown", "d.txt", "e.html", "f.HTM", "g.opml", "h.CSV"] {
            fs::write(d.path().join(n), b"x").unwrap();
            assert_eq!(read_source(&d.path().join(n)).unwrap(), b"x", "{n}");
        }
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 8, "no files were added");
    }

    #[test]
    fn refuses_bad_extension_directory_missing_and_oversize() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("a.exe"), b"x").unwrap();
        fs::write(d.path().join("noext"), b"x").unwrap();
        fs::create_dir(d.path().join("dir.md")).unwrap();
        assert!(read_source(&d.path().join("a.exe")).is_err());
        assert!(read_source(&d.path().join("noext")).is_err());
        assert!(read_source(&d.path().join("dir.md")).unwrap_err().to_string().contains("not a file"));
        assert!(read_source(&d.path().join("missing.md")).is_err());
        let big = d.path().join("big.docx");
        fs::File::create(&big).unwrap().set_len(MAX_IMPORT_BYTES + 1).unwrap();
        assert!(read_source(&big).unwrap_err().to_string().contains("larger"));
    }

    #[test]
    fn reads_relative_images() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("img")).unwrap();
        fs::write(d.path().join("img/a.png"), PNG).unwrap();
        let md = d.path().join("book.md");
        assert_eq!(read_relative_image(&md, "img/a.png").unwrap(), PNG);
        assert_eq!(read_relative_image(&md, "./img/a.png").unwrap(), PNG);
    }

    #[test]
    fn rejects_absolute_parent_backslash_and_non_image_refs() {
        let d = tempfile::tempdir().unwrap();
        let outer = d.path();
        fs::create_dir(outer.join("sub")).unwrap();
        fs::write(outer.join("secret.png"), PNG).unwrap();
        fs::write(outer.join("sub/notes.txt"), b"hi").unwrap();
        fs::write(outer.join("sub/fake.png"), b"not an image").unwrap();
        let md = outer.join("sub/book.md");
        let abs = outer.join("secret.png").to_string_lossy().to_string();
        for bad in ["../secret.png", "a/../../secret.png", abs.as_str(), "", "..\\secret.png", "notes.txt", "fake.png", "missing.png", "sub"] {
            assert!(read_relative_image(&md, bad).is_err(), "{bad}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_but_allows_symlink_inside() {
        let d = tempfile::tempdir().unwrap();
        let outer = d.path();
        fs::create_dir(outer.join("sub")).unwrap();
        fs::write(outer.join("secret.png"), PNG).unwrap();
        fs::write(outer.join("sub/real.png"), PNG).unwrap();
        std::os::unix::fs::symlink(outer.join("secret.png"), outer.join("sub/link.png")).unwrap();
        std::os::unix::fs::symlink(outer, outer.join("sub/up")).unwrap();
        std::os::unix::fs::symlink(outer.join("sub/real.png"), outer.join("sub/inner.png")).unwrap();
        let md = outer.join("sub/book.md");
        assert!(read_relative_image(&md, "link.png").unwrap_err().to_string().contains("outside"));
        assert!(read_relative_image(&md, "up/secret.png").unwrap_err().to_string().contains("outside"));
        assert_eq!(read_relative_image(&md, "inner.png").unwrap(), PNG);
    }

    fn png_of_len(path: &Path, len: u64) {
        let mut f = fs::File::create(path).unwrap();
        std::io::Write::write_all(&mut f, &PNG).unwrap();
        f.set_len(len).unwrap(); // sparse: the rest reads as zeros
    }

    #[test]
    fn extension_allowlist_edge_cases() {
        let d = tempfile::tempdir().unwrap();
        for n in ["a.HTML", "a.Md", "a.tar.html", "a b.docx", "é.txt", "a..md"] {
            fs::write(d.path().join(n), b"x").unwrap();
            assert!(read_source(&d.path().join(n)).is_ok(), "{n} should be allowed");
        }
        for n in ["a.html.exe", ".html", ".md", "noext", "a.", "a.md.", "a.md ", "a. md", "a.html~", "a.docx.zip", "a.csv.exe", "a.opml.bak", "a.csv "] {
            fs::write(d.path().join(n), b"x").unwrap();
            assert_eq!(read_source(&d.path().join(n)).unwrap_err(), ProjectError::UnsupportedDocument { name: n.into() }, "{n}");
        }
    }

    #[test]
    fn relative_source_paths_are_refused() {
        assert_eq!(read_source(Path::new("book.md")).unwrap_err(), ProjectError::UnsafePath { path: "book.md".into() });
        assert!(matches!(read_relative_image(Path::new("book.md"), "a.png").unwrap_err(), ProjectError::UnsafePath { .. }));
    }

    #[test]
    fn missing_and_icloud_sources_have_typed_errors() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read_source(&d.path().join("gone.md")).unwrap_err(), ProjectError::NotFound { path: "gone.md".into() });
        // An evicted iCloud file shows up as `.name.icloud` and the real name is missing.
        fs::write(d.path().join(".cloud.docx.icloud"), b"stub").unwrap();
        assert_eq!(read_source(&d.path().join("cloud.docx")).unwrap_err(), ProjectError::IcloudPending { path: "cloud.docx".into() });
        fs::write(d.path().join(".cloud.png.icloud"), b"stub").unwrap();
        assert_eq!(read_relative_image(&d.path().join("book.md"), "cloud.png").unwrap_err(), ProjectError::IcloudPending { path: "cloud.png".into() });
    }

    #[cfg(unix)]
    #[test]
    fn permission_denied_is_typed_and_not_a_raw_io_error() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let (a, img) = (d.path().join("a.md"), d.path().join("p.png"));
        fs::write(&a, b"x").unwrap();
        fs::write(&img, PNG).unwrap();
        fs::set_permissions(&a, fs::Permissions::from_mode(0o000)).unwrap();
        fs::set_permissions(&img, fs::Permissions::from_mode(0o000)).unwrap();
        // (as root permissions do not apply, so there is nothing to check)
        let denied = fs::File::open(&a).is_err();
        let (source, image) = (read_source(&a), read_relative_image(&d.path().join("book.md"), "p.png"));
        assert!(!denied || source.unwrap_err() == ProjectError::PermissionDenied { path: "a.md".into() });
        assert!(!denied || image.unwrap_err() == ProjectError::PermissionDenied { path: "p.png".into() });
        // A folder that cannot be searched makes the image path itself unreadable.
        let locked = d.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let through = read_relative_image(&d.path().join("book.md"), "locked/p.png");
        let denied = fs::read_dir(&locked).is_err();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!denied || through.unwrap_err() == ProjectError::PermissionDenied { path: "locked/p.png".into() });
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_sources_follow_the_picked_link_but_must_be_regular_files() {
        let d = tempfile::tempdir().unwrap();
        let (outer, picked) = (d.path().join("outer"), d.path().join("picked"));
        fs::create_dir_all(&outer).unwrap();
        fs::create_dir_all(&picked).unwrap();
        fs::write(outer.join("real.md"), b"outside").unwrap();
        fs::create_dir(outer.join("dir")).unwrap();
        std::os::unix::fs::symlink(outer.join("real.md"), picked.join("link.md")).unwrap();
        std::os::unix::fs::symlink(outer.join("dir"), picked.join("dirlink.md")).unwrap();
        std::os::unix::fs::symlink(outer.join("nope.md"), picked.join("dangling.md")).unwrap();
        std::os::unix::fs::symlink(picked.join("loop.md"), picked.join("loop.md")).unwrap();
        // The user picked the link, so it is read (the file itself is the document); links to non-files are refused.
        assert_eq!(read_source(&picked.join("link.md")).unwrap(), b"outside");
        assert_eq!(read_source(&picked.join("dirlink.md")).unwrap_err(), ProjectError::NotAFile { path: "dirlink.md".into() });
        assert!(matches!(read_source(&picked.join("dangling.md")).unwrap_err(), ProjectError::NotFound { .. }));
        assert!(read_source(&picked.join("loop.md")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn special_files_are_refused_without_blocking() {
        let d = tempfile::tempdir().unwrap();
        let fifo = d.path().join("pipe.md");
        let img = d.path().join("pipe.png");
        for p in [&fifo, &img] {
            assert!(std::process::Command::new("mkfifo").arg(p).status().unwrap().success());
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let md = d.path().join("book.md");
        std::thread::spawn(move || {
            let _ = tx.send((read_source(&fifo), read_relative_image(&md, "pipe.png")));
        });
        let (a, b) = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("reading a fifo must not hang");
        assert_eq!(a.unwrap_err(), ProjectError::NotAFile { path: "pipe.md".into() });
        assert_eq!(b.unwrap_err(), ProjectError::NotAFile { path: "pipe.png".into() });
        std::os::unix::fs::symlink("/dev/null", d.path().join("null.md")).unwrap(); // a character device
        assert_eq!(read_source(&d.path().join("null.md")).unwrap_err(), ProjectError::NotAFile { path: "null.md".into() });
    }

    #[test]
    fn source_size_cap_boundaries() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("cap.docx");
        fs::File::create(&p).unwrap().set_len(MAX_IMPORT_BYTES).unwrap();
        assert_eq!(read_source(&p).unwrap().len() as u64, MAX_IMPORT_BYTES, "exactly the cap is allowed");
        fs::File::create(&p).unwrap().set_len(MAX_IMPORT_BYTES + 1).unwrap();
        assert_eq!(read_source(&p).unwrap_err(), ProjectError::TooLarge { path: "cap.docx".into(), max_mb: 200 });
    }

    #[test]
    fn empty_and_odd_encodings_come_back_byte_for_byte() {
        // Decoding is the importer's job (TypeScript); the native layer never alters, strips or rejects text bytes.
        let d = tempfile::tempdir().unwrap();
        let cases: [(&str, &[u8]); 5] =
            [("empty.md", b""), ("bom.md", b"\xef\xbb\xbf# Title"), ("utf16.txt", b"\xff\xfeH\x00i\x00"), ("latin1.html", b"caf\xe9"), ("nul.md", b"a\0b")];
        for (n, b) in cases {
            fs::write(d.path().join(n), b).unwrap();
            assert_eq!(read_source(&d.path().join(n)).unwrap(), b, "{n}");
        }
    }

    #[test]
    fn image_size_cap_boundaries() {
        let d = tempfile::tempdir().unwrap();
        let md = d.path().join("book.md");
        for (len, ok) in [(MAX_IMAGE_BYTES - 1, true), (MAX_IMAGE_BYTES, true), (MAX_IMAGE_BYTES + 1, false)] {
            png_of_len(&d.path().join("big.png"), len);
            let got = read_relative_image(&md, "big.png");
            if ok {
                assert_eq!(got.unwrap().len() as u64, len);
            } else {
                assert_eq!(got.unwrap_err(), ProjectError::TooLarge { path: "big.png".into(), max_mb: 25 });
            }
        }
    }

    #[test]
    fn image_content_checks() {
        let d = tempfile::tempdir().unwrap();
        let md = d.path().join("book.md");
        let put = |n: &str, b: &[u8]| fs::write(d.path().join(n), b).unwrap();
        put("empty.png", b"");
        put("html.png", b"<html><body>hi</body></html>");
        put("png-as.jpg", &PNG);
        put("ok.svg", b"\xef\xbb\xbf<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>");
        put("utf16.svg", b"\xff\xfe<\x00s\x00v\x00g\x00>\x00");
        put("html.svg", b"<html>no vector here</html>");
        for bad in ["empty.png", "html.png", "png-as.jpg", "utf16.svg", "html.svg"] {
            assert!(matches!(read_relative_image(&md, bad).unwrap_err(), ProjectError::InvalidImage { .. }), "{bad}");
        }
        assert!(read_relative_image(&md, "ok.svg").is_ok(), "svg is allowed (shown through <img> only, see docs/architecture.md)");
    }

    #[test]
    fn huge_dimension_images_are_refused() {
        let d = tempfile::tempdir().unwrap();
        let md = d.path().join("book.md");
        let mut png = PNG[..8].to_vec();
        png.extend_from_slice(&[0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0xea, 0x60, 0, 0, 0xea, 0x60, 8, 6, 0, 0, 0]); // 60000 x 60000
        fs::write(d.path().join("bomb.png"), &png).unwrap();
        assert_eq!(read_relative_image(&md, "bomb.png").unwrap_err(), ProjectError::ImageDimensions { name: "bomb.png".into(), max_megapixels: 150 });
    }

    #[test]
    fn reference_shapes_that_must_never_reach_the_disk() {
        let d = tempfile::tempdir().unwrap();
        let md = d.path().join("book.md");
        for bad in [
            "C:/x.png",
            "C:\\x.png",
            "c:x.png",
            "//server/share/x.png",
            "\\\\server\\share\\x.png",
            "/abs.png",
            "file:///etc/x.png",
            "a/../b.png",
            "./../x.png",
            "a/./../../x.png",
            "x.png:stream",
            "\0.png",
            "a\0.png",
        ] {
            assert!(matches!(read_relative_image(&md, bad), Err(ProjectError::ImageRefNotAllowed { .. })), "{bad:?}");
        }
        assert!(read_relative_image(&md, &format!("{}.png", "a/".repeat(5000))).is_err());
    }

    #[test]
    fn unicode_and_spaced_references_work() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("im ages é")).unwrap();
        fs::write(d.path().join("im ages é/picture 日本.PNG"), PNG).unwrap();
        let md = d.path().join("book.md");
        assert_eq!(read_relative_image(&md, "im ages é/picture 日本.PNG").unwrap(), PNG);
        assert_eq!(read_relative_image(&md, "./im ages é//picture 日本.PNG").unwrap(), PNG);
        assert!(matches!(read_relative_image(&md, "im ages é").unwrap_err(), ProjectError::UnsupportedImage { .. }));
    }

    #[test]
    fn a_directory_named_like_an_image_or_document_is_not_a_file() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("x.png")).unwrap();
        fs::create_dir(d.path().join("x.html")).unwrap();
        assert_eq!(read_relative_image(&d.path().join("book.md"), "x.png").unwrap_err(), ProjectError::NotAFile { path: "x.png".into() });
        assert_eq!(read_source(&d.path().join("x.html")).unwrap_err(), ProjectError::NotAFile { path: "x.html".into() });
    }

    #[test]
    fn errors_are_typed() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("a.exe"), b"x").unwrap();
        assert_eq!(read_source(&d.path().join("a.exe")).unwrap_err(), ProjectError::UnsupportedDocument { name: "a.exe".into() });
        let md = d.path().join("book.md");
        assert_eq!(read_relative_image(&md, "../x.png").unwrap_err(), ProjectError::ImageRefNotAllowed { reference: "../x.png".into() });
        assert_eq!(read_relative_image(&md, "a\0b.png").unwrap_err(), ProjectError::ImageRefNotAllowed { reference: "a\0b.png".into() });
        assert_eq!(read_relative_image(&md, "gone.png").unwrap_err(), ProjectError::ImageRefNotFound { reference: "gone.png".into() });
        assert_eq!(read_relative_image(&md, "n.txt").unwrap_err(), ProjectError::UnsupportedImage { name: "n.txt".into() });
    }

    #[test]
    fn a_relative_path_without_a_name_is_refused_by_what_it_is_and_a_missing_document_folder_is_not_found() {
        assert!(matches!(read_source(Path::new("..")), Err(ProjectError::UnsafePath { path }) if path == ".."));
        let d = tempfile::tempdir().unwrap();
        let gone = d.path().join("no-such-folder").join("book.md");
        assert!(matches!(read_relative_image(&gone, "pic.png"), Err(ProjectError::NotFound { .. })));
    }
}

#[cfg(test)]
mod edge;

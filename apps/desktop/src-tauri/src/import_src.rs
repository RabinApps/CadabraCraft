//! Read-only access to files the user picked for import. Nothing here writes next to the source file.
use crate::project::{image_ext, image_too_large, looks_like, ProjectError, MAX_IMAGE_BYTES};
use std::fs;
use std::path::{Component, Path, PathBuf};

type Result<T> = std::result::Result<T, ProjectError>;

/// Document types the importer understands.
pub const IMPORT_EXTENSIONS: [&str; 6] = ["docx", "md", "markdown", "html", "htm", "txt"];
/// Largest source document accepted, in bytes.
pub const MAX_IMPORT_BYTES: u64 = 200 * 1024 * 1024;

/// Reads a document the user picked (absolute path). Only allowlisted extensions, regular files, capped size.
pub fn read_source(path: &Path) -> Result<Vec<u8>> {
    let name = path.file_name().and_then(|n| n.to_str()).ok_or(ProjectError::InvalidFileName)?;
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !IMPORT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(ProjectError::UnsupportedDocument { name: name.to_string() });
    }
    let too_large = || ProjectError::TooLarge { path: name.to_string(), max_mb: MAX_IMPORT_BYTES / 1024 / 1024 };
    let meta = fs::metadata(path)?;
    if !meta.is_file() {
        return Err(ProjectError::NotAFile { path: name.to_string() });
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(too_large());
    }
    let bytes = fs::read(path)?;
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

/// Reads an image a Markdown file references, relative to that file's folder. Refuses absolute paths, `..`,
/// symlinks that lead outside the folder, non-image extensions, oversized files and content that is not the claimed type.
pub fn read_relative_image(source_file: &Path, reference: &str) -> Result<Vec<u8>> {
    let shown: String = reference.chars().take(80).collect();
    let rel = Path::new(reference);
    let safe = !reference.is_empty()
        && !reference.contains('\\')
        && !reference.contains('\0')
        && rel.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if !safe {
        return Err(ProjectError::ImageRefNotAllowed { reference: shown });
    }
    let ext = image_ext(reference).ok_or_else(|| ProjectError::UnsupportedImage { name: shown.clone() })?;
    let base: PathBuf = source_file.parent().ok_or(ProjectError::InvalidFileName)?.to_path_buf();
    let base = fs::canonicalize(&base)?;
    let full = fs::canonicalize(base.join(rel)).map_err(|_| ProjectError::ImageRefNotFound { reference: shown.clone() })?;
    if !full.starts_with(&base) {
        return Err(ProjectError::ImageRefOutside { reference: shown });
    }
    let meta = fs::metadata(&full)?;
    if !meta.is_file() {
        return Err(ProjectError::NotAFile { path: shown });
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(image_too_large(&shown));
    }
    let bytes = fs::read(&full)?;
    if !looks_like(&ext, &bytes) {
        return Err(ProjectError::InvalidImage { name: shown, ext });
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

    #[test]
    fn reads_allowed_sources_and_leaves_them_untouched() {
        let d = tempfile::tempdir().unwrap();
        for n in ["a.docx", "b.MD", "c.markdown", "d.txt", "e.html", "f.HTM"] {
            fs::write(d.path().join(n), b"x").unwrap();
            assert_eq!(read_source(&d.path().join(n)).unwrap(), b"x", "{n}");
        }
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 6, "no files were added");
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
}

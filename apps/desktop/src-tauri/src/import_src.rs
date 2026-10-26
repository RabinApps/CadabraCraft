//! Read-only access to files the user picked for import. Nothing here writes next to the source file.
use crate::project::{image_ext, looks_like, MAX_IMAGE_BYTES};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Document types the importer understands.
pub const IMPORT_EXTENSIONS: [&str; 4] = ["docx", "md", "markdown", "txt"];
/// Largest source document accepted, in bytes.
pub const MAX_IMPORT_BYTES: u64 = 200 * 1024 * 1024;

/// Reads a document the user picked (absolute path). Only allowlisted extensions, regular files, capped size.
pub fn read_source(path: &Path) -> Result<Vec<u8>, String> {
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("invalid file name")?;
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !IMPORT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("{name} is not a .docx, .md, .markdown or .txt file"));
    }
    let meta = fs::metadata(path).map_err(|e| format!("{name}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{name} is not a file"));
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(format!("{name} is larger than {} MB", MAX_IMPORT_BYTES / 1024 / 1024));
    }
    let bytes = fs::read(path).map_err(|e| format!("{name}: {e}"))?;
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return Err(format!("{name} is larger than {} MB", MAX_IMPORT_BYTES / 1024 / 1024));
    }
    Ok(bytes)
}

/// Reads an image a Markdown file references, relative to that file's folder. Refuses absolute paths, `..`,
/// symlinks that lead outside the folder, non-image extensions, oversized files and content that is not the claimed type.
pub fn read_relative_image(source_file: &Path, reference: &str) -> Result<Vec<u8>, String> {
    let shown: String = reference.chars().take(80).collect();
    let rel = Path::new(reference);
    let safe = !reference.is_empty()
        && !reference.contains('\\')
        && !reference.contains('\0')
        && rel.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    if !safe {
        return Err(format!("image path is not allowed: {shown}"));
    }
    let ext = image_ext(reference).ok_or_else(|| format!("unsupported image type: {shown}"))?;
    let base: PathBuf = source_file.parent().ok_or("source file has no folder")?.to_path_buf();
    let base = fs::canonicalize(&base).map_err(|e| e.to_string())?;
    let full = fs::canonicalize(base.join(rel)).map_err(|_| format!("image not found: {shown}"))?;
    if !full.starts_with(&base) {
        return Err(format!("image is outside the document folder: {shown}"));
    }
    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("{shown} is not a file"));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!("{shown} is larger than {} MB", MAX_IMAGE_BYTES / 1024 / 1024));
    }
    let bytes = fs::read(&full).map_err(|e| e.to_string())?;
    if !looks_like(&ext, &bytes) {
        return Err(format!("{shown} is not a valid {ext} image"));
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
        for n in ["a.docx", "b.MD", "c.markdown", "d.txt"] {
            fs::write(d.path().join(n), b"x").unwrap();
            assert_eq!(read_source(&d.path().join(n)).unwrap(), b"x", "{n}");
        }
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 4, "no files were added");
    }

    #[test]
    fn refuses_bad_extension_directory_missing_and_oversize() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("a.exe"), b"x").unwrap();
        fs::write(d.path().join("noext"), b"x").unwrap();
        fs::create_dir(d.path().join("dir.md")).unwrap();
        assert!(read_source(&d.path().join("a.exe")).is_err());
        assert!(read_source(&d.path().join("noext")).is_err());
        assert!(read_source(&d.path().join("dir.md")).unwrap_err().contains("not a file"));
        assert!(read_source(&d.path().join("missing.md")).is_err());
        let big = d.path().join("big.docx");
        fs::File::create(&big).unwrap().set_len(MAX_IMPORT_BYTES + 1).unwrap();
        assert!(read_source(&big).unwrap_err().contains("larger"));
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
        assert!(read_relative_image(&md, "link.png").unwrap_err().contains("outside"));
        assert!(read_relative_image(&md, "up/secret.png").unwrap_err().contains("outside"));
        assert_eq!(read_relative_image(&md, "inner.png").unwrap(), PNG);
    }
}

//! Streaming a large file into the project: the bytes go from the source to the temp file in chunks, never into memory whole.
use super::{atomic_write_with, open_error, retry_transient};
use crate::project::paths::resolve;
use crate::project::{io_error, ProjectError, Result};
use std::fs;
use std::io::Read;
use std::path::Path;

/// Copies the regular file `src` (at most `cap` bytes) to `rel` under `exports/` of the project, atomically, like `write_bytes` but
/// without reading the file into memory. A folder, fifo or device is `not_a_file`; a file over the cap, or one that grows past it
/// while it is copied, is refused with `too_large()` and the target is left as it was. `label` names the source in errors (never a
/// path). Returns the number of bytes written.
pub fn write_bytes_from_file(root: &Path, rel: &str, src: &Path, cap: u64, label: &str, too_large: &dyn Fn() -> ProjectError) -> Result<u64> {
    retry_transient(|| {
        let target = resolve(root, rel)?;
        if !rel.starts_with("exports/") || rel.ends_with('/') {
            return Err(ProjectError::UnsafePath { path: rel.to_string() });
        }
        let mut written = 0;
        atomic_write_with(&target, &mut |dst| {
            written = copy_regular(src, dst, cap, label, too_large)?;
            Ok(())
        })?;
        Ok(written)
    })
}

/// The checks of `read_capped` (regular file, size, opened-handle size, read capped at `cap + 1`) with a copy instead of a buffer.
fn copy_regular(src: &Path, dst: &mut fs::File, cap: u64, label: &str, too_large: &dyn Fn() -> ProjectError) -> Result<u64> {
    let not_file = || ProjectError::NotAFile { path: label.to_string() };
    let meta = fs::metadata(src).map_err(|e| open_error(e, src, label))?;
    if !meta.is_file() {
        return Err(not_file());
    }
    if meta.len() > cap {
        return Err(too_large());
    }
    let file = fs::File::open(src).map_err(|e| open_error(e, src, label))?;
    let meta = file.metadata().map_err(|e| io_error(e, label))?;
    if !meta.is_file() {
        return Err(not_file());
    }
    if meta.len() > cap {
        return Err(too_large());
    }
    let copied = std::io::copy(&mut file.take(cap + 1), dst).map_err(|e| io_error(e, label))?;
    if copied > cap {
        return Err(too_large());
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{create_project, write_bytes};

    fn book() -> (tempfile::TempDir, std::path::PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("book");
        create_project(&root, "{}").unwrap();
        (d, root)
    }

    fn too_large() -> ProjectError {
        ProjectError::TooLarge { path: "src.bin".into(), max_mb: 1 }
    }

    fn stream(root: &Path, rel: &str, src: &Path, cap: u64) -> Result<u64> {
        write_bytes_from_file(root, rel, src, cap, "src.bin", &too_large)
    }

    #[test]
    fn a_file_is_copied_in_full_into_exports() {
        let (d, root) = book();
        let src = d.path().join("src.bin");
        let data: Vec<u8> = (0..1_000_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(&src, &data).unwrap();
        assert_eq!(stream(&root, "exports/audio/b.m4b", &src, 1_000_000).unwrap(), 1_000_000);
        assert_eq!(fs::read(root.join("exports/audio/b.m4b")).unwrap(), data);
        let leftovers = fs::read_dir(root.join("exports/audio")).unwrap().count();
        assert_eq!(leftovers, 1, "no temp file stays beside the output");
    }

    #[test]
    fn an_empty_file_is_an_empty_output_and_a_replaced_output_changes_atomically() {
        let (d, root) = book();
        let src = d.path().join("src.bin");
        fs::write(&src, b"").unwrap();
        write_bytes(&root, "exports/b.m4b", b"old").unwrap();
        assert_eq!(stream(&root, "exports/b.m4b", &src, 4).unwrap(), 0);
        assert_eq!(fs::read(root.join("exports/b.m4b")).unwrap(), b"");
    }

    #[test]
    fn a_file_over_the_cap_is_refused_and_the_old_output_stays() {
        let (d, root) = book();
        let src = d.path().join("src.bin");
        fs::write(&src, [7u8; 5]).unwrap();
        write_bytes(&root, "exports/b.m4b", b"old").unwrap();
        assert_eq!(stream(&root, "exports/b.m4b", &src, 4), Err(too_large()));
        assert_eq!(fs::read(root.join("exports/b.m4b")).unwrap(), b"old");
        assert_eq!(fs::read_dir(root.join("exports")).unwrap().count(), 1, "the temp file is removed");
    }

    #[test]
    fn only_exports_inside_the_project_can_be_written() {
        let (d, root) = book();
        let src = d.path().join("src.bin");
        fs::write(&src, b"x").unwrap();
        for rel in ["cadabra.json", "manuscript/a.json", "exports/", "../exports/a", "exports/../cadabra.json"] {
            assert!(stream(&root, rel, &src, 4).is_err(), "{rel}");
        }
        assert_eq!(fs::read_to_string(root.join("cadabra.json")).unwrap(), "{}");
    }

    #[test]
    fn a_folder_or_a_missing_source_is_not_a_file() {
        let (d, root) = book();
        assert!(matches!(stream(&root, "exports/a.m4b", d.path(), 4), Err(ProjectError::NotAFile { .. })));
        assert!(matches!(stream(&root, "exports/a.m4b", &d.path().join("none"), 4), Err(ProjectError::NotFound { .. })));
        assert!(!root.join("exports/a.m4b").exists());
    }

    #[test]
    fn the_size_limit_is_inclusive() {
        let (d, _root) = book();
        let src = d.path().join("src.bin");
        fs::write(&src, [1u8; 3]).unwrap();
        let mut dst = tempfile::tempfile().unwrap();
        assert_eq!(copy_regular(&src, &mut dst, 3, "src.bin", &too_large), Ok(3));
        assert_eq!(copy_regular(&src, &mut dst, 2, "src.bin", &too_large), Err(too_large()));
    }
}

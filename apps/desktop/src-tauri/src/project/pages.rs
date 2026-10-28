//! Reading and writing project text files (pages, manifest) with external-edit conflict copies.
use super::fsio::{atomic_write, hash_bytes, read_capped, stamp};
use super::paths::resolve;
use super::snapshots::{self, SnapshotMode};
use super::{ProjectError, Result};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Largest text file `read_file` returns, in bytes. Chapters and the manifest are far smaller; this stops a huge or
/// hostile file from being pulled into memory and sent over IPC.
pub const MAX_READ_BYTES: u64 = 32 * 1024 * 1024;

/// Result of reading a file: its text and a hash used later to detect external edits.
#[derive(Serialize, Debug, PartialEq)]
pub struct FileRead {
    pub contents: String,
    pub hash: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct WriteResult {
    pub hash: String,
    /// Relative path of the kept copy of the externally changed version, if there was a conflict.
    pub conflict_copy: Option<String>,
}

/// Reads a project file (at most `MAX_READ_BYTES`). Returns None if it does not exist. A cloud placeholder that is not
/// downloaded yet is an error, never an empty file.
pub fn read_file(root: &Path, rel: &str) -> Result<Option<FileRead>> {
    let path = resolve(root, rel)?;
    let too_large = || ProjectError::TooLarge { path: rel.to_string(), max_mb: MAX_READ_BYTES / 1024 / 1024 };
    if path.is_dir() {
        return Err(ProjectError::NotAFile { path: rel.to_string() }); // Windows refuses to open a directory with a different error
    }
    let mut file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if path.with_file_name(format!(".{name}.icloud")).exists() {
                return Err(ProjectError::IcloudPending { path: rel.to_string() });
            }
            return Ok(None);
        }
        Err(e) => return Err(e.into()),
    };
    let meta = file.metadata()?;
    let bytes = read_capped(&mut file, meta.is_file(), meta.len(), MAX_READ_BYTES).map_err(|e| e.into_project(rel, &too_large, &ProjectError::from))?;
    let hash = hash_bytes(&bytes);
    let contents = String::from_utf8(bytes).map_err(|_| ProjectError::NotUtf8 { path: rel.to_string() })?;
    Ok(Some(FileRead { contents, hash }))
}

/// `<dir>/<stem>.conflict-YYYYMMDD-HHMM[-N].<ext>` for the first name not already taken, so a second conflict in the
/// same minute never overwrites the first kept copy. Only the file name is split at its last dot, never the directory.
fn free_conflict_name(root: &Path, rel: &str) -> Result<String> {
    let (dir, name) = rel.rsplit_once('/').unwrap_or(("", rel));
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let ext = if ext.is_empty() { String::new() } else { format!(".{ext}") };
    let stamp = stamp();
    let mut n = 1u32;
    loop {
        let suffix = if n == 1 { String::new() } else { format!("-{n}") };
        let file = format!("{stem}.conflict-{stamp}{suffix}{ext}");
        let copy = if dir.is_empty() { file } else { format!("{dir}/{file}") };
        if !resolve(root, &copy)?.exists() {
            return Ok(copy);
        }
        n += 1;
    }
}

/// Writes a project file. If `base_hash` is given and the file on disk no longer matches it (it changed outside
/// the app, e.g. through sync), the on-disk version is kept as `<name>.conflict-YYYYMMDD-HHMM.<ext>` first. The text a
/// page save replaces is kept as a snapshot (see `snapshots`), at most every `SNAPSHOT_INTERVAL_MINUTES`.
pub fn write_file(root: &Path, rel: &str, contents: &str, base_hash: Option<&str>) -> Result<WriteResult> {
    write_file_with(root, rel, contents, base_hash, SnapshotMode::Throttled)
}

pub(crate) fn write_file_with(root: &Path, rel: &str, contents: &str, base_hash: Option<&str>, snapshot: SnapshotMode) -> Result<WriteResult> {
    let path = resolve(root, rel)?;
    let mut conflict_copy = None;
    let existing = fs::read(&path).ok();
    if let (Some(base), Some(existing)) = (base_hash, &existing) {
        if hash_bytes(existing) != base {
            let copy = free_conflict_name(root, rel)?;
            atomic_write(&resolve(root, &copy)?, existing)?;
            conflict_copy = Some(copy);
        }
    }
    if let Some(existing) = &existing {
        // Best effort: a snapshot that cannot be written (full disk, no permission) must not stop the save itself.
        let _ = snapshots::keep_before_overwrite(root, rel, existing, contents.as_bytes(), snapshot, chrono::Utc::now());
    }
    atomic_write(&path, contents.as_bytes())?;
    Ok(WriteResult { hash: hash_bytes(contents.as_bytes()), conflict_copy })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn read_missing_is_none_and_hash_matches() {
        let d = tmp();
        assert_eq!(read_file(d.path(), "manuscript/x.json").unwrap(), None);
        write_file(d.path(), "manuscript/x.json", "hi", None).unwrap();
        let r = read_file(d.path(), "manuscript/x.json").unwrap().unwrap();
        assert_eq!(r.contents, "hi");
        assert_eq!(r.hash, hash_bytes(b"hi"));
    }

    #[test]
    fn icloud_placeholder_is_an_error_not_empty() {
        let d = tmp();
        fs::create_dir_all(d.path().join("manuscript")).unwrap();
        fs::write(d.path().join("manuscript/.x.json.icloud"), b"").unwrap();
        assert!(read_file(d.path(), "manuscript/x.json").unwrap_err().to_string().contains("iCloud"));
    }

    #[test]
    fn matching_base_hash_writes_without_conflict() {
        let d = tmp();
        let w1 = write_file(d.path(), "manuscript/x.json", "v1", None).unwrap();
        let w2 = write_file(d.path(), "manuscript/x.json", "v2", Some(&w1.hash)).unwrap();
        assert_eq!(w2.conflict_copy, None);
        assert_eq!(fs::read_to_string(d.path().join("manuscript/x.json")).unwrap(), "v2");
    }

    #[test]
    fn second_conflict_in_the_same_minute_keeps_the_first_copy() {
        let d = tmp();
        write_file(d.path(), "manuscript/x.json", "v1", None).unwrap();
        fs::write(d.path().join("manuscript/x.json"), "external one").unwrap();
        let a = write_file(d.path(), "manuscript/x.json", "mine one", Some("stale")).unwrap().conflict_copy.unwrap();
        fs::write(d.path().join("manuscript/x.json"), "external two").unwrap();
        let b = write_file(d.path(), "manuscript/x.json", "mine two", Some("stale")).unwrap().conflict_copy.unwrap();
        assert_ne!(a, b);
        assert_eq!(fs::read_to_string(d.path().join(&a)).unwrap(), "external one");
        assert_eq!(fs::read_to_string(d.path().join(&b)).unwrap(), "external two");
    }

    #[test]
    fn external_change_keeps_both_versions() {
        let d = tmp();
        let w1 = write_file(d.path(), "manuscript/x.json", "v1", None).unwrap();
        fs::write(d.path().join("manuscript/x.json"), "external").unwrap(); // sync changed it behind our back
        let w2 = write_file(d.path(), "manuscript/x.json", "mine", Some(&w1.hash)).unwrap();
        let copy = w2.conflict_copy.expect("conflict copy");
        assert!(copy.starts_with("manuscript/x.conflict-") && copy.ends_with(".json"), "{copy}");
        assert_eq!(fs::read_to_string(d.path().join(&copy)).unwrap(), "external");
        assert_eq!(fs::read_to_string(d.path().join("manuscript/x.json")).unwrap(), "mine");
    }

    #[test]
    fn read_file_caps_size_and_rejects_directories() {
        let d = tmp();
        fs::create_dir_all(d.path().join("manuscript/dir.json")).unwrap();
        assert!(matches!(read_file(d.path(), "manuscript/dir.json").unwrap_err(), ProjectError::NotAFile { .. }));
        let big = d.path().join("manuscript/big.json");
        fs::File::create(&big).unwrap().set_len(MAX_READ_BYTES + 1).unwrap();
        assert_eq!(read_file(d.path(), "manuscript/big.json").unwrap_err(), ProjectError::TooLarge { path: "manuscript/big.json".into(), max_mb: 32 });
        fs::File::create(&big).unwrap().set_len(MAX_READ_BYTES).unwrap(); // exactly at the cap is allowed
        assert_eq!(read_file(d.path(), "manuscript/big.json").unwrap().unwrap().contents.len() as u64, MAX_READ_BYTES);
    }

    #[test]
    fn non_utf8_is_a_typed_error() {
        let d = tmp();
        fs::create_dir_all(d.path().join("manuscript")).unwrap();
        fs::write(d.path().join("manuscript/x.json"), [0xff, 0xfe]).unwrap();
        assert_eq!(read_file(d.path(), "manuscript/x.json").unwrap_err(), ProjectError::NotUtf8 { path: "manuscript/x.json".into() });
    }

    #[test]
    fn icloud_placeholder_has_its_own_code() {
        let d = tmp();
        fs::create_dir_all(d.path().join("manuscript")).unwrap();
        fs::write(d.path().join("manuscript/.x.json.icloud"), b"").unwrap();
        assert_eq!(read_file(d.path(), "manuscript/x.json").unwrap_err(), ProjectError::IcloudPending { path: "manuscript/x.json".into() });
        // The placeholder itself is a normal dotfile path and resolves fine.
        assert!(resolve(d.path(), "manuscript/.x.json.icloud").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_page_is_an_error_and_a_fifo_is_not_a_file() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let page = d.path().join("manuscript/001-a.json");
        fs::create_dir_all(page.parent().unwrap()).unwrap();
        fs::write(&page, "{}").unwrap();
        fs::set_permissions(&page, fs::Permissions::from_mode(0o000)).unwrap();
        let denied = fs::File::open(&page).is_err(); // false when running as root
        let result = read_file(d.path(), "manuscript/001-a.json");
        fs::set_permissions(&page, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!denied || matches!(result, Err(ProjectError::Io { .. })));
        // Opening a fifo for reading waits for a writer, so one is provided; the page is then refused as not a file.
        let fifo = d.path().join("manuscript/002-b.json");
        assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
        let writer = fifo.clone();
        std::thread::spawn(move || drop(fs::OpenOptions::new().write(true).open(writer)));
        let root = d.path().to_path_buf();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || drop(tx.send(read_file(&root, "manuscript/002-b.json"))));
        let got = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("reading a fifo page must not hang");
        assert_eq!(got.unwrap_err(), ProjectError::NotAFile { path: "manuscript/002-b.json".into() });
    }
}

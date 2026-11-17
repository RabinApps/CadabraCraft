//! Reading and writing project text files (pages, manifest) with external-edit conflict copies.
use super::fsio::{atomic_write, hash_bytes, read_regular, stamp};
use super::paths::resolve;
use super::snapshots::{self, SnapshotMode};
use super::{ProjectError, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

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
    // `read_regular` looks at the file type before opening, so a fifo or device is refused instead of blocking forever.
    let bytes = match read_regular(&path, MAX_READ_BYTES, rel, too_large) {
        Ok(b) => b,
        Err(ProjectError::NotFound { .. }) => return Ok(None),
        Err(e) => return Err(e),
    };
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

/// Runs `f` while holding a lock for `path`, so two saves of the same page (autosave and a save on close) cannot
/// interleave their read-compare-write and lose a conflict copy. Entries are tiny and live for the session.
fn with_path_lock<T>(path: &Path, f: impl FnOnce() -> T) -> T {
    static LOCKS: OnceLock<PathLocks> = OnceLock::new();
    with_lock_in(LOCKS.get_or_init(Default::default), path, f)
}

type PathLocks = Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>;

/// `with_path_lock` over a given set of locks. A lock poisoned by a panicking save is still taken: the data it guards is
/// the file on disk, not anything the panic left half-done in memory.
fn with_lock_in<T>(locks: &PathLocks, path: &Path, f: impl FnOnce() -> T) -> T {
    let lock = lock_of(locks, path);
    let _guard = hold(&lock);
    f()
}

/// The lock of `path`, made on first use.
fn lock_of(locks: &PathLocks, path: &Path) -> Arc<Mutex<()>> {
    locks.lock().unwrap_or_else(|e| e.into_inner()).entry(path.to_path_buf()).or_default().clone()
}

fn hold(lock: &Mutex<()>) -> std::sync::MutexGuard<'_, ()> {
    lock.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn write_file_with(root: &Path, rel: &str, contents: &str, base_hash: Option<&str>, snapshot: SnapshotMode) -> Result<WriteResult> {
    // The same cap as a read: a file written here must be readable again (and a snapshot of it restorable).
    if contents.len() as u64 > MAX_READ_BYTES {
        return Err(ProjectError::TooLarge { path: rel.to_string(), max_mb: MAX_READ_BYTES / 1024 / 1024 });
    }
    let path = resolve(root, rel)?;
    with_path_lock(&path, || write_locked(root, rel, &path, contents, base_hash, snapshot))
}

fn write_locked(root: &Path, rel: &str, path: &Path, contents: &str, base_hash: Option<&str>, snapshot: SnapshotMode) -> Result<WriteResult> {
    let mut conflict_copy = None;
    // Only a missing file is "new"; any other failure (unreadable, a folder, too large) must not skip the conflict check.
    let existing = match read_regular(path, MAX_READ_BYTES, rel, || ProjectError::TooLarge { path: rel.to_string(), max_mb: MAX_READ_BYTES / 1024 / 1024 }) {
        Ok(b) => Some(b),
        Err(ProjectError::NotFound { .. }) => None,
        Err(e) => return Err(e),
    };
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
    atomic_write(path, contents.as_bytes())?;
    Ok(WriteResult { hash: hash_bytes(contents.as_bytes()), conflict_copy })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::*;
    use std::fs;

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
    fn write_file_caps_contents_at_the_read_cap() {
        let d = tmp();
        let at_cap = "x".repeat(MAX_READ_BYTES as usize);
        write_file(d.path(), "manuscript/big.json", &at_cap, None).unwrap();
        assert_eq!(read_file(d.path(), "manuscript/big.json").unwrap().unwrap().contents.len() as u64, MAX_READ_BYTES, "what is written can be read back");
        let over = "x".repeat(MAX_READ_BYTES as usize + 1);
        assert_eq!(
            write_file(d.path(), "manuscript/big2.json", &over, None).unwrap_err(),
            ProjectError::TooLarge { path: "manuscript/big2.json".into(), max_mb: 32 }
        );
        assert!(!d.path().join("manuscript/big2.json").exists());
        assert!(write_file(d.path(), "manuscript/empty.json", "", None).is_ok(), "zero bytes are fine");
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

    #[test]
    fn a_poisoned_lock_is_still_taken() {
        fn poison<T: Send>(m: &Mutex<T>) {
            let _ = std::thread::scope(|s| {
                s.spawn(|| {
                    let _held = m.lock().unwrap();
                    panic!("poisoned on purpose");
                })
                .join()
            });
        }
        let locks: PathLocks = Mutex::new(HashMap::new());
        let path = Path::new("manuscript/001-a.json");
        assert_eq!(with_lock_in(&locks, path, || 1), 1);
        let inner = locks.lock().unwrap().get(path).unwrap().clone();
        poison(&*inner);
        poison(&locks);
        assert_eq!(with_lock_in(&locks, path, || 2), 2);
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
        assert!(!denied || matches!(result, Err(ProjectError::PermissionDenied { .. } | ProjectError::Io { .. })));
        // A save must not treat an unreadable page as new (that would skip the conflict copy).
        fs::set_permissions(&page, fs::Permissions::from_mode(0o000)).unwrap();
        let write = write_file(d.path(), "manuscript/001-a.json", "new", Some("stale"));
        fs::set_permissions(&page, fs::Permissions::from_mode(0o644)).unwrap();
        if denied {
            assert!(write.is_err());
            assert_eq!(fs::read_to_string(&page).unwrap(), "{}");
        }
        // Opening a fifo for reading waits for a writer, and none ever comes; the page must be refused without opening it.
        let fifo = d.path().join("manuscript/002-b.json");
        assert!(std::process::Command::new("mkfifo").arg(&fifo).status().unwrap().success());
        let root = d.path().to_path_buf();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || drop(tx.send(read_file(&root, "manuscript/002-b.json"))));
        let got = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("reading a fifo page must not hang");
        assert_eq!(got.unwrap_err(), ProjectError::NotAFile { path: "manuscript/002-b.json".into() });
    }

    #[test]
    fn a_save_of_a_folder_or_oversized_page_is_an_error_not_a_blind_overwrite() {
        let d = tmp();
        fs::create_dir_all(d.path().join("manuscript/dir.json")).unwrap();
        assert!(matches!(write_file(d.path(), "manuscript/dir.json", "x", Some("h")).unwrap_err(), ProjectError::NotAFile { .. }));
        let big = d.path().join("manuscript/big.json");
        fs::File::create(&big).unwrap().set_len(MAX_READ_BYTES + 1).unwrap();
        assert!(matches!(write_file(d.path(), "manuscript/big.json", "x", Some("h")).unwrap_err(), ProjectError::TooLarge { .. }));
        assert_eq!(fs::metadata(&big).unwrap().len(), MAX_READ_BYTES + 1);
    }

    #[test]
    fn concurrent_saves_of_one_page_each_keep_the_version_they_replace() {
        let d = tmp();
        write_file(d.path(), "manuscript/x.json", "v0", None).unwrap();
        let root = d.path().to_path_buf();
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let root = root.clone();
                std::thread::spawn(move || write_file(&root, "manuscript/x.json", &format!("w{i}"), Some("stale")).unwrap())
            })
            .collect();
        let copies: Vec<String> = handles.into_iter().map(|h| h.join().unwrap().conflict_copy.expect("every save sees a changed file")).collect();
        let mut unique = copies.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 8, "{copies:?}");
        let kept: std::collections::HashSet<String> = copies.iter().map(|c| fs::read_to_string(d.path().join(c)).unwrap()).collect();
        assert_eq!(kept.len(), 8); // v0 plus seven of the eight writes: every replaced version is somewhere
    }
}

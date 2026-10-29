//! Atomic file writes, bounded reads and iCloud placeholder detection.
use super::paths::{free_copy_name, free_name, resolve};
use super::{io_error, ProjectError, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

pub fn hash_bytes(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

/// Write to a uniquely named temp file in the same directory, then rename, so a crash or sync never leaves a half-written
/// file. The temp file is removed if anything fails, and concurrent writers never share a temp name.
///
/// Failures are typed (`permission_denied`, `disk_full`, `not_a_file` for a folder where the file should go or a file
/// where a folder should be) and name only the file, never an absolute path.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    retry_transient(|| atomic_write_once(path, bytes))
}

/// Windows refuses to replace a file that another handle has open or is replacing at that moment (antivirus and
/// indexers do this too), reporting `PermissionDenied`, or `NotFound` while the other rename is in flight. Those are
/// transient, so retry a bounded number of times with a short growing pause; a real denial (read-only folder) still
/// fails, after about a second. Other platforms make a single attempt.
pub(crate) fn retry_transient<T>(mut attempt: impl FnMut() -> Result<T>) -> Result<T> {
    #[cfg(windows)]
    {
        let mut pause_ms = 2u64;
        for _ in 0..24 {
            match attempt() {
                Err(ProjectError::PermissionDenied { .. } | ProjectError::NotFound { .. }) => {
                    std::thread::sleep(std::time::Duration::from_millis(pause_ms));
                    pause_ms = (pause_ms * 2).min(50);
                }
                done => return done,
            }
        }
    }
    attempt()
}

fn atomic_write_once(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().ok_or(ProjectError::InvalidFileName)?;
    let label = path.file_name().and_then(|n| n.to_str()).ok_or(ProjectError::InvalidFileName)?;
    let io = |e: std::io::Error| io_error(e, label);
    // A folder in the way: rename-over-directory fails with an OS-specific error, so say it plainly (and early).
    if fs::symlink_metadata(path).map(|m| m.is_dir()).unwrap_or(false) {
        return Err(ProjectError::NotAFile { path: label.to_string() });
    }
    // An existing *file* where a folder is needed (`exports` is a file) reports `AlreadyExists` on some platforms.
    fs::create_dir_all(dir).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => ProjectError::NotAFile { path: dir.file_name().and_then(|n| n.to_str()).unwrap_or(label).to_string() },
        _ => io(e),
    })?;
    // `.<random>.tmp`: dot-prefixed and `.tmp`-suffixed, which the file watcher ignores.
    let mut tmp = tempfile::Builder::new().prefix(".").suffix(".tmp").tempfile_in(dir).map_err(io)?;
    tmp.write_all(bytes).map_err(io)?;
    tmp.as_file().sync_all().map_err(io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // tempfile creates 0600; keep the existing file's mode, or the usual 0644 for a new one.
        let mode = fs::metadata(path).map(|m| m.permissions().mode() & 0o7777).unwrap_or(0o644);
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(mode)).map_err(io)?;
    }
    tmp.persist(path).map_err(|e| io(e.error))?; // on failure `e.file` drops and deletes the temp file
    sync_dir(dir);
    Ok(())
}

/// Flushes a directory's entries to disk, so a rename or new file in it survives a power cut (the file's own data is
/// fsynced separately). Best effort by design: the rename already happened and the data is safe, so failing the save
/// because the filesystem cannot fsync a directory (network and cloud folders, FAT) would only mislead. Windows cannot
/// open a directory as a file, so there it does nothing.
pub(crate) fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

/// Moves `from` to `to` without ever replacing an existing `to`: a hard link is created first (atomic, fails with
/// `AlreadyExists` when `to` exists, on every platform) and then the old name is removed. A filesystem that has no
/// hard links (exFAT, some cloud folders) falls back to an exists check plus `rename`, which only leaves a tiny race
/// window instead of none. Both directories are fsynced afterwards.
pub(crate) fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    rename_no_replace_with(from, to, |a, b| fs::hard_link(a, b))
}

pub(crate) fn rename_no_replace_with(from: &Path, to: &Path, link: impl Fn(&Path, &Path) -> std::io::Result<()>) -> std::io::Result<()> {
    match link(from, to) {
        Ok(()) => {
            if let Err(e) = fs::remove_file(from) {
                let _ = fs::remove_file(to); // never leave the page under two names
                return Err(e);
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Err(e),
        Err(_) => {
            if to.symlink_metadata().is_ok() {
                return Err(std::io::ErrorKind::AlreadyExists.into());
            }
            fs::rename(from, to)?;
        }
    }
    for p in [to, from] {
        if let Some(dir) = p.parent() {
            sync_dir(dir);
        }
    }
    Ok(())
}

/// Moves the file `from` to the project-relative `want`, or to `want-2`, `-3`... when that name is (or becomes, in a
/// race) taken, creating the folder first. Never replaces anything; returns the relative path used. I/O failures are
/// reported against `label`.
pub(crate) fn move_to_free_name(root: &Path, from: &Path, want: &str, label: &str) -> Result<String> {
    move_to_free_name_with(root, from, want, label, free_name, rename_no_replace)
}

/// Like `move_to_free_name` for backup and trash copies: a taken name gets the `~2`, `~3`... counter (`free_copy_name`).
pub(crate) fn move_to_free_copy_name(root: &Path, from: &Path, want: &str, label: &str) -> Result<String> {
    move_to_free_name_with(root, from, want, label, free_copy_name, rename_no_replace)
}

pub(crate) fn move_to_free_name_with(
    root: &Path,
    from: &Path,
    want: &str,
    label: &str,
    pick: impl Fn(&Path, &str) -> Result<String>,
    mv: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<String> {
    for _ in 0..64 {
        let to_rel = pick(root, want)?;
        let to = resolve(root, &to_rel)?;
        fs::create_dir_all(to.parent().ok_or(ProjectError::InvalidFileName)?).map_err(|e| io_error(e, label))?;
        match mv(from, &to) {
            Ok(()) => return Ok(to_rel),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {} // lost a race: free_name now skips that name
            Err(e) => return Err(io_error(e, label)),
        }
    }
    Err(io_error(std::io::ErrorKind::AlreadyExists.into(), label))
}

/// True when `path` is an iCloud placeholder that has not been downloaded: the real name is missing and macOS left
/// `.<name>.icloud` beside it.
pub(crate) fn icloud_pending(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|name| path.with_file_name(format!(".{name}.icloud")).exists())
}

/// An IO failure while opening something that may be missing: a placeholder, a plain absence, or any other typed error.
pub(crate) fn open_error(e: std::io::Error, path: &Path, label: &str) -> ProjectError {
    use std::io::ErrorKind::{NotADirectory, NotFound};
    if matches!(e.kind(), NotFound | NotADirectory) {
        return if icloud_pending(path) { ProjectError::IcloudPending { path: label.to_string() } } else { ProjectError::NotFound { path: label.to_string() } };
    }
    io_error(e, label)
}

/// Reads a regular file of at most `cap` bytes. A folder, fifo or device is `not_a_file` without being opened (a fifo
/// would block forever); the size is checked on the opened handle too, and the read itself is capped at `cap + 1`, so a
/// file that grows while it is read can never use unbounded memory. Links are followed (the user picked the link).
pub(crate) fn read_regular(path: &Path, cap: u64, label: &str, too_large: impl Fn() -> ProjectError) -> Result<Vec<u8>> {
    let not_file = || ProjectError::NotAFile { path: label.to_string() };
    let meta = fs::metadata(path).map_err(|e| open_error(e, path, label))?;
    if !meta.is_file() {
        return Err(not_file());
    }
    if meta.len() > cap {
        return Err(too_large());
    }
    let mut file = fs::File::open(path).map_err(|e| open_error(e, path, label))?;
    let meta = file.metadata().map_err(|e| io_error(e, label))?;
    read_capped(&mut file, meta.is_file(), meta.len(), cap).map_err(|e| e.into_project(label, &too_large, &|e| io_error(e, label)))
}

/// Why `read_capped` refused.
#[derive(Debug)]
pub(crate) enum CappedError {
    NotAFile,
    TooLarge,
    Io(std::io::Error),
}

impl CappedError {
    /// The error the caller reports: `label` for a file that is not one, `too_large` for a file over the cap, `io` for a failed read.
    pub(crate) fn into_project(self, label: &str, too_large: &dyn Fn() -> ProjectError, io: &dyn Fn(std::io::Error) -> ProjectError) -> ProjectError {
        match self {
            CappedError::NotAFile => ProjectError::NotAFile { path: label.to_string() },
            CappedError::TooLarge => too_large(),
            CappedError::Io(e) => io(e),
        }
    }
}

/// Reads an already opened file of at most `cap` bytes, given its metadata (`is_file`, `len`). The checks are repeated on
/// the opened handle because the path may have been swapped since it was first inspected, and the read is capped at
/// `cap + 1` so a file that grows while it is read can never use unbounded memory.
pub(crate) fn read_capped(reader: &mut dyn Read, is_file: bool, len: u64, cap: u64) -> std::result::Result<Vec<u8>, CappedError> {
    if !is_file {
        return Err(CappedError::NotAFile);
    }
    if len > cap {
        return Err(CappedError::TooLarge);
    }
    let mut bytes = Vec::with_capacity(len as usize);
    reader.take(cap + 1).read_to_end(&mut bytes).map_err(CappedError::Io)?;
    if bytes.len() as u64 > cap {
        return Err(CappedError::TooLarge);
    }
    Ok(bytes)
}

pub(crate) fn stamp() -> String {
    chrono::Utc::now().format("%Y%m%d-%H%M").to_string()
}

/// Writes binary output (EPUB, PDF, Markdown) under `exports/` of the project, atomically. Only `exports/<name>` is
/// accepted: the webview has no reason to rewrite the manifest or chapters as raw bytes, which would skip their backups.
pub fn write_bytes(root: &Path, rel: &str, bytes: &[u8]) -> Result<()> {
    // `resolve` looks at the target too, so a concurrent replace can fail it transiently on Windows; see `retry_transient`.
    retry_transient(|| {
        let target = resolve(root, rel)?;
        if !rel.starts_with("exports/") || rel.ends_with('/') {
            return Err(ProjectError::UnsafePath { path: rel.to_string() });
        }
        atomic_write_once(&target, bytes)
    })
}

/// Where lossless chapter parts for the audiobook live: local to this computer, never synced or exported.
pub const AUDIO_PARTS_DIR: &str = ".cadabra/audio/parts/";

/// Whether `rel` is exactly `.cadabra/audio/parts/<name>.flac` with a plain file name.
pub fn is_audio_part(rel: &str) -> bool {
    rel.strip_prefix(AUDIO_PARTS_DIR).is_some_and(|name| name.len() > ".flac".len() && name.ends_with(".flac") && !name.contains('/'))
}

/// Writes one chapter part (see `is_audio_part`), atomically. Same rules as `write_bytes`, for the one other place the
/// audiobook may write binary files.
pub fn write_audio_part(root: &Path, rel: &str, bytes: &[u8]) -> Result<()> {
    retry_transient(|| {
        let target = resolve(root, rel)?;
        if !is_audio_part(rel) {
            return Err(ProjectError::UnsafePath { path: rel.to_string() });
        }
        atomic_write_once(&target, bytes)
    })
}

#[cfg(test)]
mod tests {
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
        for bad in [".cadabra/audio/parts/.flac", ".cadabra/audio/parts/x.wav", ".cadabra/audio/parts/sub/x.flac", ".cadabra/audio/x.flac", "exports/x.flac", ".cadabra/audio/parts/"] {
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
        // (as root permissions do not apply, so there is nothing to check)
        assert!(probe.is_ok() || result.unwrap_err() == ProjectError::PermissionDenied { path: "book.epub".into() });
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
}

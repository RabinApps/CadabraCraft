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
    let label = path.file_name().and_then(|n| n.to_str()).ok_or(ProjectError::InvalidFileName)?;
    atomic_write_with(path, &mut |file| file.write_all(bytes).map_err(|e| io_error(e, label)))
}

/// `atomic_write` for content that is produced into the temp file by `fill` (a streamed copy), so it is never held in
/// memory whole. A failing `fill` removes the temp file and leaves the target as it was.
pub(super) fn atomic_write_with(path: &Path, fill: &mut dyn FnMut(&mut fs::File) -> Result<()>) -> Result<()> {
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
    fill(tmp.as_file_mut())?;
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
    move_to_free_name_dyn(root, from, want, label, &pick, &mv)
}

/// `move_to_free_name_with` without the per-caller generics, so the loop exists (and is tested) once.
fn move_to_free_name_dyn(
    root: &Path,
    from: &Path,
    want: &str,
    label: &str,
    pick: &dyn Fn(&Path, &str) -> Result<String>,
    mv: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
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
    read_regular_dyn(path, cap, label, &too_large)
}

/// `read_regular` without the per-caller generic, so its error paths exist (and are tested) once.
fn read_regular_dyn(path: &Path, cap: u64, label: &str, too_large: &dyn Fn() -> ProjectError) -> Result<Vec<u8>> {
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
    read_capped(&mut file, meta.is_file(), meta.len(), cap).map_err(|e| e.into_project(label, too_large, &|e| io_error(e, label)))
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

mod stream;
pub use stream::write_bytes_from_file;

#[cfg(test)]
mod tests;

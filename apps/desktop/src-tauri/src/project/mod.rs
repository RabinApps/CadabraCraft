//! Reads and writes a CadabraCraft project folder. All paths are relative to the project root.
//! Manifest parsing and migration live in `@cadabracraft/format` (TypeScript); this layer only does safe file IO.
mod error;
pub use error::ProjectError;

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

type Result<T> = std::result::Result<T, ProjectError>;

pub const MANIFEST: &str = "cadabra.json";
const DIRS: [&str; 6] = ["manuscript", "front-matter", "back-matter", "assets", "exports", ".cadabra"];
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

pub fn hash_bytes(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn is_missing(e: &std::io::Error) -> bool {
    matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory)
}

/// Fails when `abs` (which lies lexically under `root`) would reach outside the real `root` through a symbolic link.
/// The deepest part of the path that exists is resolved; the rest does not exist yet, so cannot be a link. A dangling
/// link is refused, because writing through it would create its target elsewhere.
fn ensure_contained(root: &Path, abs: &Path, rel: &str) -> Result<()> {
    let Ok(real_root) = fs::canonicalize(root) else { return Ok(()) }; // no root yet, so no links to follow
    let escape = || ProjectError::PathEscape { path: rel.to_string() };
    let mut cur = abs;
    loop {
        match fs::symlink_metadata(cur) {
            Ok(_) => {
                let real = fs::canonicalize(cur).map_err(|_| escape())?; // dangling link or loop
                return if real.starts_with(&real_root) { Ok(()) } else { Err(escape()) };
            }
            Err(e) if is_missing(&e) => match cur.parent() {
                Some(p) => cur = p,
                None => return Ok(()),
            },
            Err(e) => return Err(e.into()),
        }
    }
}

/// Joins `rel` onto `root`, refusing empty, absolute and `..` paths, backslashes, NUL bytes, and anything that would
/// leave the project through a symbolic link.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel);
    let ok = !rel.is_empty() && !rel.contains('\\') && !rel.contains('\0') && p.components().all(|c| matches!(c, Component::Normal(_)));
    if !ok {
        return Err(ProjectError::UnsafePath { path: rel.to_string() });
    }
    let abs = root.join(p);
    ensure_contained(root, &abs, rel)?;
    Ok(abs)
}

/// Write to a uniquely named temp file in the same directory, then rename, so a crash or sync never leaves a half-written
/// file. The temp file is removed if anything fails, and concurrent writers never share a temp name.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().ok_or(ProjectError::InvalidFileName)?;
    fs::create_dir_all(dir)?;
    // `.<random>.tmp`: dot-prefixed and `.tmp`-suffixed, which the file watcher ignores.
    let mut tmp = tempfile::Builder::new().prefix(".").suffix(".tmp").tempfile_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // tempfile creates 0600; keep the existing file's mode, or the usual 0644 for a new one.
        let mode = fs::metadata(path).map(|m| m.permissions().mode() & 0o7777).unwrap_or(0o644);
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(mode))?;
    }
    tmp.persist(path).map_err(|e| ProjectError::from(e.error))?; // on failure `e.file` drops and deletes the temp file
    Ok(())
}

fn stamp() -> String {
    chrono::Utc::now().format("%Y%m%d-%H%M").to_string()
}

/// A project root must be an absolute path: the webview never gets to name a folder relative to wherever the app runs.
pub fn require_absolute(root: &Path) -> Result<PathBuf> {
    if root.is_absolute() {
        Ok(root.to_path_buf())
    } else {
        Err(ProjectError::NotAProject { path: root.to_string_lossy().into_owned() })
    }
}

/// Every command except creating a project works only inside an existing project: an absolute folder that holds a real
/// `cadabra.json` file (not a link). This keeps a bad `root` from reading or writing arbitrary folders.
pub fn require_project(root: &Path) -> Result<PathBuf> {
    let root = require_absolute(root)?;
    match fs::symlink_metadata(root.join(MANIFEST)) {
        Ok(md) if md.is_file() => Ok(root),
        _ => Err(ProjectError::NotAProject { path: root.to_string_lossy().into_owned() }),
    }
}

/// Creates the folder layout and writes the manifest. Refuses to touch an existing project.
pub fn create_project(root: &Path, manifest_json: &str) -> Result<()> {
    if root.join(MANIFEST).exists() {
        return Err(ProjectError::AlreadyExists);
    }
    for d in DIRS {
        fs::create_dir_all(root.join(d))?;
    }
    atomic_write(&resolve(root, MANIFEST)?, manifest_json.as_bytes())
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
    if !meta.is_file() {
        return Err(ProjectError::NotAFile { path: rel.to_string() });
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(too_large());
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    (&mut file).take(MAX_READ_BYTES + 1).read_to_end(&mut bytes)?; // the file may have grown since `metadata`
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(too_large());
    }
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
/// the app, e.g. through sync), the on-disk version is kept as `<name>.conflict-YYYYMMDD-HHMM.<ext>` first.
pub fn write_file(root: &Path, rel: &str, contents: &str, base_hash: Option<&str>) -> Result<WriteResult> {
    let path = resolve(root, rel)?;
    let mut conflict_copy = None;
    if let (Some(base), Ok(existing)) = (base_hash, fs::read(&path)) {
        if hash_bytes(&existing) != base {
            let copy = free_conflict_name(root, rel)?;
            atomic_write(&resolve(root, &copy)?, &existing)?;
            conflict_copy = Some(copy);
        }
    }
    atomic_write(&path, contents.as_bytes())?;
    Ok(WriteResult { hash: hash_bytes(contents.as_bytes()), conflict_copy })
}

/// Writes binary output (EPUB/PDF) under the project, atomically.
pub fn write_bytes(root: &Path, rel: &str, bytes: &[u8]) -> Result<()> {
    atomic_write(&resolve(root, rel)?, bytes)
}

/// Copies the manifest into `.cadabra/backups/` before a migration rewrites it. Returns the backup's relative path.
pub fn backup_manifest(root: &Path) -> Result<String> {
    let rel = format!(".cadabra/backups/cadabra-{}.json", stamp());
    let bytes = fs::read(resolve(root, MANIFEST)?)?;
    atomic_write(&resolve(root, &rel)?, &bytes)?;
    Ok(rel)
}

/// `<dir>/<stem>-N.<ext>` for the first N >= 2 not taken (or `rel` itself when free). Only the file name is split.
fn free_name(root: &Path, rel: &str) -> Result<String> {
    if !resolve(root, rel)?.exists() {
        return Ok(rel.to_string());
    }
    let slash = rel.rfind('/').map_or(0, |i| i + 1);
    let (stem, ext) = match rel.rfind('.') {
        Some(d) if d > slash => (&rel[..d], &rel[d..]),
        _ => (rel, ""),
    };
    let mut n = 2u32;
    loop {
        let cand = format!("{stem}-{n}{ext}");
        if !resolve(root, &cand)?.exists() {
            return Ok(cand);
        }
        n += 1;
    }
}

/// "Deletes" a file by moving it to `.cadabra/trash/`. Nothing is permanently removed by the app, and an earlier
/// trashed file with the same name (same minute) is never overwritten.
pub fn trash_file(root: &Path, rel: &str) -> Result<String> {
    let from = resolve(root, rel)?;
    if !from.exists() {
        return Err(ProjectError::NotFound { path: rel.to_string() });
    }
    let name = rel.replace('/', "__");
    let to_rel = free_name(root, &format!(".cadabra/trash/{}-{name}", stamp()))?;
    let to = resolve(root, &to_rel)?;
    fs::create_dir_all(to.parent().ok_or(ProjectError::InvalidFileName)?)?;
    fs::rename(from, to)?;
    Ok(to_rel)
}

const TRASH_DIR: &str = ".cadabra/trash";
/// Folders a trashed page can be restored into.
const RESTORE_DIRS: [&str; 3] = ["manuscript", "front-matter", "back-matter"];

/// A file in the project trash that can be restored.
#[derive(Serialize, Debug, PartialEq)]
pub struct TrashEntry {
    /// Project-relative path of the trashed file (`.cadabra/trash/<stamp>-<path with / as __>`).
    pub path: String,
    /// Project-relative path it came from.
    pub original: String,
    /// `YYYYMMDD-HHMM` (UTC) it was trashed at.
    pub trashed_at: String,
}

/// Splits `<stamp>-<flattened>[-N].json` into the stamp and the original path. None for anything that is not a trashed
/// page (other file types, or paths outside manuscript/front-matter/back-matter).
///
/// Flattening turns `/` into `__`, which is ambiguous when a file name itself contains `__`. Pages live directly in
/// their folder, so only the first `__` (after the folder name) is a separator and the rest is the file name:
/// `manuscript__a__b.json` restores to `manuscript/a__b.json`.
fn parse_trash_name(name: &str) -> Option<(String, String)> {
    let b = name.as_bytes();
    let stamp_ok = b.len() > 14
        && b[..8].iter().all(u8::is_ascii_digit)
        && b[8] == b'-'
        && b[9..13].iter().all(u8::is_ascii_digit)
        && b[13] == b'-';
    if !stamp_ok || !name.ends_with(".json") {
        return None;
    }
    let (dir, file) = name[14..].split_once("__")?;
    (RESTORE_DIRS.contains(&dir) && !file.is_empty() && !file.contains('/')).then(|| (name[..13].to_string(), format!("{dir}/{file}")))
}

/// Lists restorable pages in `.cadabra/trash/`, newest first.
pub fn list_trash(root: &Path) -> Result<Vec<TrashEntry>> {
    let dir = resolve(root, TRASH_DIR)?;
    let read = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut out = vec![];
    for item in read {
        let item = item?;
        if !item.file_type()?.is_file() {
            continue;
        }
        let Some(name) = item.file_name().to_str().map(str::to_string) else { continue };
        if let Some((trashed_at, original)) = parse_trash_name(&name) {
            out.push(TrashEntry { path: format!("{TRASH_DIR}/{name}"), original, trashed_at });
        }
    }
    out.sort_by(|a, b| b.trashed_at.cmp(&a.trashed_at).then(a.path.cmp(&b.path)));
    Ok(out)
}

/// Moves a trashed page back to where it came from and returns its project-relative path. If that path is taken (a
/// chapter was added or restored since) the page comes back as `<stem>-2.json`, `-3`... and nothing is overwritten.
pub fn restore_trash(root: &Path, trash_rel: &str) -> Result<String> {
    let name = trash_rel.strip_prefix(".cadabra/trash/").ok_or_else(|| ProjectError::NotTrashPath { path: trash_rel.to_string() })?;
    let (_, original) = parse_trash_name(name).ok_or_else(|| ProjectError::CannotRestore { path: trash_rel.to_string() })?;
    let from = resolve(root, trash_rel)?;
    if !from.is_file() {
        return Err(ProjectError::NotFound { path: trash_rel.to_string() });
    }
    let to_rel = free_name(root, &original)?;
    let to = resolve(root, &to_rel)?;
    fs::create_dir_all(to.parent().ok_or(ProjectError::InvalidFileName)?)?;
    // Same-volume rename is atomic: the page is either still in the trash or fully back, never half-written.
    fs::rename(from, to)?;
    Ok(to_rel)
}

/// Image types that may be imported into `assets/`.
pub const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
/// Largest image accepted, in bytes.
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

pub(crate) fn image_too_large(name: &str) -> ProjectError {
    ProjectError::TooLarge { path: name.to_string(), max_mb: MAX_IMAGE_BYTES / 1024 / 1024 }
}

pub(crate) fn image_ext(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    IMAGE_EXTENSIONS.contains(&ext.as_str()).then_some(ext)
}

/// Cheap signature check so a renamed non-image is refused. SVG must at least look like SVG text.
pub(crate) fn looks_like(ext: &str, b: &[u8]) -> bool {
    match ext {
        "png" => b.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "jpg" | "jpeg" => b.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"),
        "webp" => b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP",
        "svg" => std::str::from_utf8(b).map(|t| t.contains("<svg")).unwrap_or(false),
        _ => false,
    }
}

/// Reduces a user file name to `[A-Za-z0-9_-]` (runs of other characters become one `-`), so it is safe on every
/// platform and in XML ids.
pub fn sanitize_asset_stem(stem: &str) -> String {
    let mut out = String::new();
    for c in stem.chars() {
        let c = if c.is_ascii_alphanumeric() || c == '_' { c } else { '-' };
        if c == '-' && (out.is_empty() || out.ends_with('-')) {
            continue;
        }
        out.push(c);
    }
    let out: String = out.trim_end_matches('-').chars().take(80).collect();
    if out.is_empty() { "image".into() } else { out }
}

/// Copies an image the user picked (absolute path) into `assets/` and returns its project-relative path.
/// Never overwrites a different file: an identical existing file is reused, otherwise `-2`, `-3`... is appended.
pub fn import_image(root: &Path, source: &Path) -> Result<String> {
    let file_name = source.file_name().and_then(|n| n.to_str()).ok_or(ProjectError::InvalidFileName)?;
    image_ext(file_name).ok_or_else(|| ProjectError::UnsupportedImage { name: file_name.to_string() })?;
    let meta = fs::metadata(source)?;
    if !meta.is_file() {
        return Err(ProjectError::NotAFile { path: file_name.to_string() });
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(image_too_large(file_name));
    }
    let bytes = fs::read(source)?;
    store_image(root, file_name, &bytes)
}

/// Validates image bytes (allowlisted extension, size, signature) and stores them in `assets/` under a sanitized,
/// de-duplicated name. Shared by the file picker import and the document importer, so both follow the same rules.
pub fn store_image(root: &Path, file_name: &str, bytes: &[u8]) -> Result<String> {
    let ext = image_ext(file_name).ok_or_else(|| ProjectError::UnsupportedImage { name: file_name.to_string() })?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(image_too_large(file_name));
    }
    if !looks_like(&ext, bytes) {
        return Err(ProjectError::InvalidImage { name: file_name.to_string(), ext });
    }
    let stem = sanitize_asset_stem(file_name.rsplit_once('.').map_or(file_name, |(s, _)| s));
    let hash = hash_bytes(bytes);
    let mut n = 1u32;
    loop {
        let name = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem}-{n}.{ext}") };
        let rel = format!("assets/{name}");
        let path = resolve(root, &rel)?;
        match fs::read(&path) {
            Ok(existing) if hash_bytes(&existing) == hash => return Ok(rel),
            Ok(_) => n += 1,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                atomic_write(&path, bytes)?;
                return Ok(rel);
            }
            Err(e) => return Err(e.into()),
        }
    }
}

/// Reads an asset's bytes for display. Only `assets/<image>` paths are served.
pub fn read_asset(root: &Path, rel: &str) -> Result<Vec<u8>> {
    if !rel.starts_with("assets/") || image_ext(rel).is_none() {
        return Err(ProjectError::NotImageAsset { path: rel.to_string() });
    }
    let path = resolve(root, rel)?;
    let meta = fs::metadata(&path)?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(image_too_large(rel));
    }
    Ok(fs::read(&path)?)
}

#[cfg(test)]
mod contract_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn trash_then_restore_round_trips_and_lists_newest_first() {
        let d = tmp();
        write_file(d.path(), "manuscript/001-a.json", "A", None).unwrap();
        let t = trash_file(d.path(), "manuscript/001-a.json").unwrap();
        assert!(!d.path().join("manuscript/001-a.json").exists());
        let list = list_trash(d.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, t);
        assert_eq!(list[0].original, "manuscript/001-a.json");
        assert_eq!(restore_trash(d.path(), &t).unwrap(), "manuscript/001-a.json");
        assert_eq!(fs::read_to_string(d.path().join("manuscript/001-a.json")).unwrap(), "A");
        assert!(list_trash(d.path()).unwrap().is_empty());
    }

    #[test]
    fn restore_never_overwrites_an_existing_page() {
        let d = tmp();
        write_file(d.path(), "front-matter/01-x.json", "old", None).unwrap();
        let t = trash_file(d.path(), "front-matter/01-x.json").unwrap();
        write_file(d.path(), "front-matter/01-x.json", "new", None).unwrap();
        assert_eq!(restore_trash(d.path(), &t).unwrap(), "front-matter/01-x-2.json");
        assert_eq!(fs::read_to_string(d.path().join("front-matter/01-x.json")).unwrap(), "new");
        assert_eq!(fs::read_to_string(d.path().join("front-matter/01-x-2.json")).unwrap(), "old");
    }

    #[test]
    fn trashing_twice_in_a_minute_keeps_both() {
        let d = tmp();
        write_file(d.path(), "manuscript/a.json", "one", None).unwrap();
        let t1 = trash_file(d.path(), "manuscript/a.json").unwrap();
        write_file(d.path(), "manuscript/a.json", "two", None).unwrap();
        let t2 = trash_file(d.path(), "manuscript/a.json").unwrap();
        assert_ne!(t1, t2);
        assert_eq!(fs::read_to_string(d.path().join(&t1)).unwrap(), "one");
        assert_eq!(list_trash(d.path()).unwrap().len(), 2);
    }

    #[test]
    fn restore_refuses_unsafe_or_foreign_paths() {
        let d = tmp();
        for bad in ["manuscript/a.json", ".cadabra/trash/../../cadabra.json", ".cadabra/trash/x.json", ".cadabra/trash/20260101-1200-assets__a.json", ".cadabra/trash/20260101-1200-manuscript__a.json"] {
            assert!(restore_trash(d.path(), bad).is_err(), "{bad}");
        }
        // Non-page files in the trash are not listed.
        fs::create_dir_all(d.path().join(".cadabra/trash")).unwrap();
        fs::write(d.path().join(".cadabra/trash/notes.txt"), "x").unwrap();
        fs::write(d.path().join(".cadabra/trash/20260101-1200-assets__a.json"), "x").unwrap();
        assert!(list_trash(d.path()).unwrap().is_empty());
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
    fn resolve_rejects_escapes() {
        let r = Path::new("/p");
        for bad in ["../x", "/etc/passwd", "a/../../b", "", "a\\b", "./x"] {
            assert!(resolve(r, bad).is_err(), "{bad}");
        }
        assert_eq!(resolve(r, "manuscript/001-a.json").unwrap(), Path::new("/p/manuscript/001-a.json"));
    }

    #[test]
    fn create_makes_layout_and_never_overwrites() {
        let d = tmp();
        create_project(d.path(), "{\"formatVersion\":1}").unwrap();
        for dir in DIRS {
            assert!(d.path().join(dir).is_dir(), "{dir}");
        }
        assert!(create_project(d.path(), "{\"formatVersion\":1,\"x\":1}").is_err());
        assert_eq!(fs::read_to_string(d.path().join(MANIFEST)).unwrap(), "{\"formatVersion\":1}");
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
    fn backup_and_trash_preserve_content() {
        let d = tmp();
        create_project(d.path(), "{\"formatVersion\":1}").unwrap();
        let b = backup_manifest(d.path()).unwrap();
        assert_eq!(fs::read_to_string(d.path().join(b)).unwrap(), "{\"formatVersion\":1}");
        write_file(d.path(), "manuscript/x.json", "keep me", None).unwrap();
        let t = trash_file(d.path(), "manuscript/x.json").unwrap();
        assert!(!d.path().join("manuscript/x.json").exists());
        assert_eq!(fs::read_to_string(d.path().join(t)).unwrap(), "keep me");
        assert!(trash_file(d.path(), "manuscript/nope.json").is_err());
    }

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

    fn src(d: &tempfile::TempDir, name: &str, bytes: &[u8]) -> PathBuf {
        let p = d.path().join(name);
        fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn import_copies_into_assets_and_sanitizes_name() {
        let (proj, out) = (tmp(), tmp());
        let s = src(&out, "My Cover (final)!.PNG", &PNG);
        let rel = import_image(proj.path(), &s).unwrap();
        assert_eq!(rel, "assets/My-Cover-final.png");
        assert_eq!(fs::read(proj.path().join(&rel)).unwrap(), PNG);
        assert!(s.exists(), "source is left alone");
        assert_eq!(sanitize_asset_stem("../../etc"), "etc");
        assert_eq!(sanitize_asset_stem("???"), "image");
    }

    #[test]
    fn import_reuses_identical_and_suffixes_different() {
        let (proj, out) = (tmp(), tmp());
        let a = src(&out, "a.png", &PNG);
        assert_eq!(import_image(proj.path(), &a).unwrap(), "assets/a.png");
        assert_eq!(import_image(proj.path(), &a).unwrap(), "assets/a.png");
        let mut other = PNG.to_vec();
        other.push(9);
        let sub = out.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("a.png"), &other).unwrap();
        assert_eq!(import_image(proj.path(), &sub.join("a.png")).unwrap(), "assets/a-2.png");
        other.push(10);
        fs::write(sub.join("a.png"), &other).unwrap();
        assert_eq!(import_image(proj.path(), &sub.join("a.png")).unwrap(), "assets/a-3.png");
        assert_eq!(fs::read(proj.path().join("assets/a.png")).unwrap(), PNG, "original untouched");
    }

    #[test]
    fn import_rejects_bad_extension_content_size_and_non_files() {
        let (proj, out) = (tmp(), tmp());
        assert!(import_image(proj.path(), &src(&out, "x.exe", &PNG)).unwrap_err().to_string().contains("unsupported"));
        assert!(import_image(proj.path(), &src(&out, "noext", &PNG)).is_err());
        assert!(import_image(proj.path(), &src(&out, "fake.png", b"not an image")).unwrap_err().to_string().contains("not a valid"));
        assert!(import_image(proj.path(), &out.path().join("missing.png")).is_err());
        let dir = out.path().join("d.png");
        fs::create_dir(&dir).unwrap();
        assert!(import_image(proj.path(), &dir).unwrap_err().to_string().contains("not a file"));
        let big = out.path().join("big.png");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(import_image(proj.path(), &big).unwrap_err().to_string().contains("larger"));
        assert!(!proj.path().join("assets").exists());
    }

    #[test]
    fn store_image_sanitizes_dedupes_and_validates_bytes() {
        let proj = tmp();
        assert_eq!(store_image(proj.path(), "../Fig 1.PNG", &PNG).unwrap(), "assets/Fig-1.png");
        assert_eq!(store_image(proj.path(), "Fig 1.png", &PNG).unwrap(), "assets/Fig-1.png");
        let mut other = PNG.to_vec();
        other.push(1);
        assert_eq!(store_image(proj.path(), "Fig 1.png", &other).unwrap(), "assets/Fig-1-2.png");
        assert!(store_image(proj.path(), "x.exe", &PNG).unwrap_err().to_string().contains("unsupported"));
        assert!(store_image(proj.path(), "x.png", b"nope").unwrap_err().to_string().contains("not a valid"));
        let big = vec![0u8; MAX_IMAGE_BYTES as usize + 1];
        assert!(store_image(proj.path(), "big.png", &big).unwrap_err().to_string().contains("larger"));
    }

    #[test]
    fn import_accepts_every_allowed_type() {
        let (proj, out) = (tmp(), tmp());
        let cases: [(&str, &[u8]); 6] = [
            ("a.png", &PNG),
            ("b.jpg", &[0xff, 0xd8, 0xff, 0xe0]),
            ("c.jpeg", &[0xff, 0xd8, 0xff, 0xe0, 1]),
            ("d.gif", b"GIF89a.."),
            ("e.webp", b"RIFF\0\0\0\0WEBPVP8 "),
            ("f.svg", b"<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
        ];
        for (n, b) in cases {
            assert_eq!(import_image(proj.path(), &src(&out, n, b)).unwrap(), format!("assets/{n}"));
        }
    }

    #[test]
    fn read_asset_only_serves_images_under_assets() {
        let (proj, out) = (tmp(), tmp());
        let rel = import_image(proj.path(), &src(&out, "a.png", &PNG)).unwrap();
        assert_eq!(read_asset(proj.path(), &rel).unwrap(), PNG);
        write_file(proj.path(), "manuscript/x.json", "{}", None).unwrap();
        for bad in ["manuscript/x.json", "assets/../cadabra.json", "assets/notes.txt", "../a.png", "/etc/a.png", "assets/missing.png"] {
            assert!(read_asset(proj.path(), bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn require_project_accepts_only_absolute_folders_with_a_manifest() {
        let d = tmp();
        let root = d.path().join("book");
        fs::create_dir_all(&root).unwrap();
        let not = |p: &Path| ProjectError::NotAProject { path: p.to_string_lossy().into_owned() };
        assert_eq!(require_project(&root), Err(not(&root))); // no manifest yet
        assert_eq!(require_project(Path::new("relative/book")), Err(not(Path::new("relative/book"))));
        assert_eq!(require_project(Path::new("")), Err(not(Path::new(""))));
        fs::create_dir_all(root.join(MANIFEST)).unwrap(); // a folder named cadabra.json is not a manifest
        assert_eq!(require_project(&root), Err(not(&root)));
        fs::remove_dir(root.join(MANIFEST)).unwrap();
        fs::write(root.join(MANIFEST), "{}").unwrap();
        assert_eq!(require_project(&root), Ok(root.clone()));
        assert_eq!(require_absolute(&root), Ok(root.clone()));
        assert_eq!(require_absolute(Path::new("book")), Err(not(Path::new("book"))));
    }

    #[cfg(unix)]
    #[test]
    fn require_project_refuses_a_manifest_that_is_a_link() {
        let d = tmp();
        let (root, other) = (d.path().join("book"), d.path().join("other.json"));
        fs::create_dir_all(&root).unwrap();
        fs::write(&other, "{}").unwrap();
        std::os::unix::fs::symlink(&other, root.join(MANIFEST)).unwrap();
        assert!(matches!(require_project(&root), Err(ProjectError::NotAProject { .. })));
    }

    #[test]
    fn resolve_rejects_nul_and_returns_typed_errors() {
        let r = Path::new("/p");
        assert_eq!(resolve(r, "a\0b"), Err(ProjectError::UnsafePath { path: "a\0b".into() }));
        assert_eq!(resolve(r, "../x"), Err(ProjectError::UnsafePath { path: "../x".into() }));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_refuses_symlink_escapes_for_every_operation() {
        let d = tmp();
        let (proj, outside) = (d.path().join("project"), d.path().join("outside"));
        fs::create_dir_all(proj.join("manuscript")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.json"), "secret").unwrap();
        std::os::unix::fs::symlink(&outside, proj.join("exports")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.json"), proj.join("manuscript/leak.json")).unwrap();
        let esc = |e: ProjectError| matches!(e, ProjectError::PathEscape { .. });
        assert!(esc(read_file(&proj, "manuscript/leak.json").unwrap_err()));
        assert!(esc(write_file(&proj, "exports/book.json", "x", None).unwrap_err()));
        assert!(esc(write_bytes(&proj, "exports/book.epub", b"x").unwrap_err()));
        assert!(esc(write_file(&proj, "manuscript/leak.json", "overwrite", None).unwrap_err()));
        assert!(!outside.join("book.json").exists() && !outside.join("book.epub").exists());
        assert_eq!(fs::read_to_string(outside.join("secret.json")).unwrap(), "secret");
        // A link that stays inside the project is fine.
        std::os::unix::fs::symlink(proj.join("manuscript"), proj.join("front-matter")).unwrap();
        write_file(&proj, "front-matter/a.json", "ok", None).unwrap();
        assert_eq!(fs::read_to_string(proj.join("manuscript/a.json")).unwrap(), "ok");
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

    #[test]
    fn create_twice_reports_already_exists() {
        let d = tmp();
        create_project(d.path(), "{}").unwrap();
        assert_eq!(create_project(d.path(), "{}").unwrap_err(), ProjectError::AlreadyExists);
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

    #[test]
    fn trash_names_with_double_underscores_round_trip() {
        let d = tmp();
        write_file(d.path(), "manuscript/a__b.json", "x", None).unwrap();
        let t = trash_file(d.path(), "manuscript/a__b.json").unwrap();
        assert_eq!(list_trash(d.path()).unwrap()[0].original, "manuscript/a__b.json");
        assert_eq!(restore_trash(d.path(), &t).unwrap(), "manuscript/a__b.json");
        assert_eq!(parse_trash_name("20260101-1200-manuscript__a__b__c.json").unwrap().1, "manuscript/a__b__c.json");
        assert_eq!(parse_trash_name("20260101-1200-assets__a__b.json"), None);
    }

    #[test]
    fn trash_and_restore_report_typed_errors() {
        let d = tmp();
        assert_eq!(trash_file(d.path(), "manuscript/nope.json").unwrap_err(), ProjectError::NotFound { path: "manuscript/nope.json".into() });
        assert!(matches!(restore_trash(d.path(), "manuscript/a.json").unwrap_err(), ProjectError::NotTrashPath { .. }));
        assert!(matches!(restore_trash(d.path(), ".cadabra/trash/x.json").unwrap_err(), ProjectError::CannotRestore { .. }));
    }

    #[test]
    fn image_errors_are_typed() {
        let proj = tmp();
        assert_eq!(store_image(proj.path(), "x.exe", &PNG).unwrap_err(), ProjectError::UnsupportedImage { name: "x.exe".into() });
        assert_eq!(store_image(proj.path(), "x.png", b"no").unwrap_err(), ProjectError::InvalidImage { name: "x.png".into(), ext: "png".into() });
        assert_eq!(read_asset(proj.path(), "manuscript/x.json").unwrap_err(), ProjectError::NotImageAsset { path: "manuscript/x.json".into() });
        assert_eq!(store_image(proj.path(), "big.png", &vec![0u8; MAX_IMAGE_BYTES as usize + 1]).unwrap_err(), ProjectError::TooLarge { path: "big.png".into(), max_mb: 25 });
    }
}

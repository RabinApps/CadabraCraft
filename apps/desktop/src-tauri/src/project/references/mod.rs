//! Reference files (research material kept beside the book): import into `references/`, ranged reads for viewing, and
//! removal to the project trash. The manifest list lives in `@cadabracraft/format`; this layer only does safe file IO.
//! Files are streamed (a video can be hundreds of megabytes), never read whole except small text files.
use super::assets::{check_image, sanitize_asset_stem};
use super::fsio::{icloud_pending, stamp};
use super::fsio::{move_to_free_copy_name, sync_dir};
use super::paths::resolve;
use super::{io_error, open_error, ProjectError, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// `io_error` as a method, so every IO failure on a named file maps to its typed error through one function.
pub(super) trait IoCtx<T> {
    fn ctx(self, label: &str) -> Result<T>;
}

impl<T> IoCtx<T> for std::io::Result<T> {
    fn ctx(self, label: &str) -> Result<T> {
        match self {
            Ok(v) => Ok(v),
            Err(e) => Err(io_error(e, label)),
        }
    }
}

const MB: u64 = 1024 * 1024;
/// Most bytes one `read_reference_range` call returns, so a 500 MB video never travels in one IPC message.
pub const MAX_CHUNK: u64 = 16 * MB;
/// Bytes of a file's start used for the signature check.
const HEADER_BYTES: usize = 64 * 1024;
const REFERENCES_DIR: &str = "references";

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceKind {
    Image,
    Video,
    Audio,
    Pdf,
    Text,
    Other,
}

/// Programs, scripts, installers, shortcuts, macro-enabled Office files and web pages: they could run, or run script,
/// when opened, so they are never imported. A list of what to refuse (not of what to allow) so that research files such
/// as `.docx`, `.xlsx`, `.epub` or `.zip` keep working; the signature checks cover the types that are served inline.
const BLOCKED: &[&str] = &[
    // Windows programs, installers and shortcuts
    "exe", "bat", "cmd", "com", "msi", "msp", "mst", "scr", "dll", "cpl", "lnk", "pif", "inf", "reg", "hta", "chm", "msc", "gadget", "scf", "application", "diagcab",
    "url", "ps1", "ps1xml", "psc1", "psm1", "psd1", "vbs", "vbe", "vb", "wsf", "wsh", "wsc", "ws", "jse", "ade", "adp", "mde",
    // macOS and Linux programs, packages, scripts and shortcuts
    "app", "dmg", "pkg", "mpkg", "command", "action", "workflow", "scpt", "scptd", "terminal", "webloc", "desktop", "appimage", "deb", "rpm", "apk", "bin", "run", "sh", "bash", "zsh",
    "csh", "tcsh", "ksh", "fish", "iso",
    // scripts and code that an interpreter or the shell would run
    "js", "mjs", "cjs", "jar", "py", "pyw", "pyc", "pyz", "rb", "pl", "pm", "php", "cgi", "swf",
    // web pages
    "html", "htm", "xhtml",
    // Office files that can carry macros
    "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam", "ppsm", "sldm",
];

pub fn kind_of(ext: &str) -> ReferenceKind {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" => ReferenceKind::Image,
        "mp4" | "m4v" | "mov" | "webm" => ReferenceKind::Video,
        "mp3" | "wav" | "ogg" | "oga" | "m4a" | "flac" => ReferenceKind::Audio,
        "pdf" => ReferenceKind::Pdf,
        "txt" | "md" | "markdown" => ReferenceKind::Text,
        _ => ReferenceKind::Other,
    }
}

/// Largest file accepted for a kind, in bytes.
pub fn max_bytes(kind: ReferenceKind) -> u64 {
    match kind {
        ReferenceKind::Video => 500 * MB,
        ReferenceKind::Audio | ReferenceKind::Pdf => 200 * MB,
        ReferenceKind::Image | ReferenceKind::Other => 100 * MB,
        ReferenceKind::Text => 5 * MB,
    }
}

fn too_large(name: &str, kind: ReferenceKind) -> ProjectError {
    ProjectError::TooLarge { path: name.to_string(), max_mb: max_bytes(kind) / MB }
}

/// Lowercase extension, or "" for none. Anything other than 1 to 10 ASCII letters and digits is refused.
pub(super) fn extension(name: &str) -> Result<String> {
    let Some((_, ext)) = name.rsplit_once('.') else { return Ok(String::new()) };
    let ext = ext.to_ascii_lowercase();
    if ext.is_empty() || ext.len() > 10 || !ext.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(ProjectError::UnsupportedReference { name: name.to_string() });
    }
    Ok(ext)
}

/// Signature check on the start of the file, so a renamed file of another type is refused. Text is checked by the caller.
fn looks_like(ext: &str, h: &[u8]) -> bool {
    let at = |i: usize, s: &[u8]| h.get(i..i + s.len()) == Some(s);
    match ext {
        "svg" => String::from_utf8_lossy(h).contains("<svg"),
        "pdf" => h.windows(5).take(1024).any(|w| w == b"%PDF-"),
        "mp4" | "m4v" | "mov" | "m4a" => h.len() > 12 && matches!(h.get(4..8), Some(b"ftyp" | b"moov" | b"mdat" | b"free" | b"wide")),
        "webm" => at(0, &[0x1a, 0x45, 0xdf, 0xa3]),
        "mp3" => at(0, b"ID3") || (h.len() > 2 && h[0] == 0xff && h[1] & 0xe0 == 0xe0),
        "wav" => at(0, b"RIFF") && at(8, b"WAVE"),
        "ogg" | "oga" => at(0, b"OggS"),
        _ => at(0, b"fLaC"), // flac: the caller only asks about the extensions above
    }
}

/// A file with no extension is kept only when its start identifies it: a known media, image or PDF signature, or plain
/// text that is not a script (`#!`). Anything else (an ELF or Mach-O program, a Windows executable, unknown bytes) is refused.
fn sniff_extensionless(h: &[u8]) -> bool {
    let at = |i: usize, s: &[u8]| h.get(i..i + s.len()) == Some(s);
    let known = ["svg", "pdf", "mp4", "webm", "mp3", "wav", "ogg", "flac"].iter().any(|e| looks_like(e, h))
        || at(0, &[0x89, b'P', b'N', b'G'])
        || at(0, &[0xff, 0xd8, 0xff])
        || at(0, b"GIF8")
        || (at(0, b"RIFF") && at(8, b"WEBP"));
    // The header may end inside a multi-byte character, so a UTF-8 error at the very end is not evidence against text.
    let text = match std::str::from_utf8(h) {
        Ok(_) => true,
        Err(e) => e.error_len().is_none(),
    };
    // Text has no control characters other than tab, line breaks and form feed (an ELF header has 0x7f and 0x02).
    let plain = h.iter().all(|&b| b >= 0x20 && b != 0x7f || matches!(b, b'\t' | b'\n' | b'\r' | 0x0c));
    known || (text && plain && !at(0, b"#!"))
}

fn hash_reader(r: &mut impl Read) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            return Ok(hasher.finalize().iter().map(|x| format!("{x:02x}")).collect());
        }
        hasher.update(&buf[..n]);
    }
}

fn file_hash(path: &Path, label: &str) -> Result<String> {
    hash_reader(&mut File::open(path).ctx(label)?).ctx(label)
}

/// A readable stem for the name on disk: `[A-Za-z0-9_-]` only, "file" when nothing is left.
fn stem_for(stem: &str) -> String {
    if stem.bytes().any(|b| b.is_ascii_alphanumeric()) { sanitize_asset_stem(stem) } else { "file".into() }
}

/// What an import reports: the project-relative file, a title to start from (the original name without extension), the
/// size, the kind, and whether an identical file was already in `references/` and is used instead of a copy.
#[derive(Serialize, Debug, PartialEq)]
pub struct ImportedReference {
    pub file: String,
    pub title: String,
    pub size: u64,
    pub kind: ReferenceKind,
    pub reused: bool,
}

/// Copies a file the user picked (absolute path) into `references/` and returns where it went. Streams the copy while
/// hashing it, checks the type, the size cap and the signature, and never overwrites: identical bytes reuse the existing
/// file, different bytes get a `-2`, `-3`... suffix.
pub fn import_reference(root: &Path, source: &Path) -> Result<ImportedReference> {
    import_reference_with(root, source, &persist_no_replace)
}

type Persist<'a> = &'a dyn Fn(tempfile::NamedTempFile, &Path) -> std::result::Result<(), (tempfile::NamedTempFile, std::io::Error)>;

/// `import_reference` with the final move injectable, so a file that appears while the import runs can be tested.
fn import_reference_with(root: &Path, source: &Path, persist: Persist) -> Result<ImportedReference> {
    let name = source.file_name().and_then(|n| n.to_str()).ok_or(ProjectError::InvalidFileName)?;
    let ext = extension(name)?;
    if BLOCKED.contains(&ext.as_str()) {
        return Err(ProjectError::UnsupportedReference { name: name.to_string() });
    }
    let kind = kind_of(&ext);
    let cap = max_bytes(kind);
    // Look at the type before opening: opening a fifo for reading waits for a writer that never comes. The handle is checked
    // again below, because the path may have been swapped in between.
    let before = fs::metadata(source).map_err(|e| open_error(e, source, name))?;
    if !before.is_file() {
        return Err(ProjectError::NotAFile { path: name.to_string() });
    }
    let mut src = File::open(source).map_err(|e| open_error(e, source, name))?;
    let meta = src.metadata().ctx(name)?;
    if !meta.is_file() {
        return Err(ProjectError::NotAFile { path: name.to_string() });
    }
    if meta.len() > cap {
        return Err(too_large(name, kind));
    }

    let dir = resolve(root, REFERENCES_DIR)?;
    fs::create_dir_all(&dir).ctx(REFERENCES_DIR)?;
    // `.<random>.tmp`: dot-prefixed and `.tmp`-suffixed, which the file watcher ignores; dropped (deleted) on any error.
    let mut tmp = tempfile::Builder::new().prefix(".").suffix(".tmp").tempfile_in(&dir).ctx(REFERENCES_DIR)?;
    let (size, hash) = copy_capped(&mut src, &mut tmp, cap, name, &too_large(name, kind))?;
    tmp.as_file().sync_all().ctx(name)?;

    let invalid = || ProjectError::InvalidReference { name: name.to_string(), ext: ext.clone() };
    let mut header = vec![0u8; HEADER_BYTES];
    let got = File::open(tmp.path()).and_then(|mut f| f.read(&mut header)).ctx(name)?;
    header.truncate(got);
    match kind {
        ReferenceKind::Image if ext == "svg" => {
            if !looks_like("svg", &header) {
                return Err(invalid());
            }
        }
        ReferenceKind::Image => match check_image(name, &ext, &header) {
            Err(ProjectError::InvalidImage { .. }) => return Err(invalid()),
            other => other?,
        },
        ReferenceKind::Text => {
            let bytes = fs::read(tmp.path()).ctx(name)?;
            if std::str::from_utf8(&bytes).is_err() || bytes.contains(&0) {
                return Err(invalid());
            }
        }
        ReferenceKind::Other if ext.is_empty() && !sniff_extensionless(&header) => return Err(ProjectError::UnsupportedReference { name: name.to_string() }),
        ReferenceKind::Other => {}
        _ if looks_like(&ext, &header) => {}
        _ => return Err(invalid()),
    }

    let stem = stem_for(name.rsplit_once('.').map_or(name, |(s, _)| s));
    let title = name.rsplit_once('.').map_or(name, |(s, _)| s).trim().to_string();
    let title = if title.is_empty() { stem.clone() } else { title };
    let mut n = 1u32;
    loop {
        let base = if n == 1 { stem.clone() } else { format!("{stem}-{n}") };
        let rel = if ext.is_empty() { format!("{REFERENCES_DIR}/{base}") } else { format!("{REFERENCES_DIR}/{base}.{ext}") };
        let path = resolve(root, &rel)?;
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && m.len() == size && file_hash(&path, &rel)? == hash => return Ok(ImportedReference { file: rel, title, size, kind, reused: true }),
            Ok(_) => n += 1,
            // Nothing there (or nothing readable there): moving in either succeeds or reports why it cannot. It never
            // replaces a file that appeared meanwhile: that name is skipped like any taken one.
            Err(_) => match persist(tmp, &path) {
                Ok(()) => {
                    sync_dir(&dir);
                    return Ok(ImportedReference { file: rel, title, size, kind, reused: false });
                }
                Err((back, e)) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    tmp = back;
                    n += 1;
                }
                Err((_, e)) => return Err(io_error(e, &rel)),
            },
        }
    }
}

/// Gives the finished temp file its final name without replacing a file of that name (hard link, then the temp name is
/// removed). Where the filesystem has no hard links it falls back to an exists check plus rename. On failure the temp
/// file is handed back so the caller can try another name.
fn persist_no_replace(tmp: tempfile::NamedTempFile, path: &Path) -> std::result::Result<(), (tempfile::NamedTempFile, std::io::Error)> {
    match tmp.persist_noclobber(path) {
        Ok(_) => Ok(()),
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => Err((e.file, e.error)),
        Err(e) if path.symlink_metadata().is_ok() => Err((e.file, std::io::ErrorKind::AlreadyExists.into())),
        Err(e) => e.file.persist(path).map(|_| ()).map_err(|e| (e.file, e.error)),
    }
}

/// Copies `src` to `dst` while hashing, stopping with the `too_large` error as soon as more than `cap` bytes have been read (a file
/// can grow after its size was checked). Returns the size and the sha256.
fn copy_capped(src: &mut dyn Read, dst: &mut dyn Write, cap: u64, name: &str, too_large: &ProjectError) -> Result<(u64, String)> {
    let (mut hasher, mut size, mut buf) = (Sha256::new(), 0u64, vec![0u8; 256 * 1024]);
    loop {
        let n = src.read(&mut buf).ctx(name)?;
        if n == 0 {
            return Ok((size, hasher.finalize().iter().map(|x| format!("{x:02x}")).collect()));
        }
        size += n as u64;
        if size > cap {
            return Err(too_large.clone());
        }
        hasher.update(&buf[..n]);
        dst.write_all(&buf[..n]).ctx(name)?;
    }
}

/// The absolute path of `references/<name>`: flat, no subfolders, inside the project.
pub fn reference_path(root: &Path, rel: &str) -> Result<PathBuf> {
    let flat = rel.strip_prefix("references/").is_some_and(|n| !n.is_empty() && !n.contains('/'));
    if !flat {
        return Err(ProjectError::NotReference { path: rel.to_string() });
    }
    resolve(root, rel)
}

pub(super) fn open_regular(root: &Path, rel: &str) -> Result<(File, u64)> {
    let path = reference_path(root, rel)?;
    // Not opened before its type is known: a fifo would block the open forever (see `import_reference_with`).
    if !fs::metadata(&path).map_err(|e| open_error(e, &path, rel))?.is_file() {
        return Err(ProjectError::NotAFile { path: rel.to_string() });
    }
    let file = File::open(&path).map_err(|e| open_error(e, &path, rel))?;
    let meta = file.metadata().ctx(rel)?;
    if !meta.is_file() {
        return Err(ProjectError::NotAFile { path: rel.to_string() });
    }
    Ok((file, meta.len()))
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ReferenceStat {
    pub size: u64,
    pub kind: ReferenceKind,
}

/// Size and kind of a reference file, so the viewer knows how many ranges to ask for.
pub fn stat_reference(root: &Path, rel: &str) -> Result<ReferenceStat> {
    let (_, size) = open_regular(root, rel)?;
    let ext = extension(rel).unwrap_or_default();
    Ok(ReferenceStat { size, kind: kind_of(&ext) })
}

/// Up to `len` bytes (at most `MAX_CHUNK`) starting at `offset`. Empty at or past the end of the file.
pub fn read_reference_range(root: &Path, rel: &str, offset: u64, len: u64) -> Result<Vec<u8>> {
    let (mut file, size) = open_regular(root, rel)?;
    if offset >= size {
        return Ok(vec![]);
    }
    file.seek(SeekFrom::Start(offset)).ctx(rel)?;
    let mut out = Vec::new();
    file.take(len.min(MAX_CHUNK)).read_to_end(&mut out).ctx(rel)?;
    Ok(out)
}

/// "Removes" a reference file by moving it to `.cadabra/trash/`, never deleting it for good. Returns the trash path.
pub fn trash_reference(root: &Path, rel: &str) -> Result<String> {
    let from = reference_path(root, rel)?;
    match from.symlink_metadata() {
        Err(_) => return Err(ProjectError::NotFound { path: rel.to_string() }),
        Ok(m) if !m.is_file() => return Err(ProjectError::NotAFile { path: rel.to_string() }),
        Ok(_) => {}
    }
    move_to_free_copy_name(root, &from, &format!(".cadabra/trash/{}-{}", stamp(), rel.replace('/', "__")), rel)
}

/// The file to hand to the operating system's default app. Refuses types that could run or run script when opened
/// (the import list, plus SVG, which a browser would open with scripts enabled) and files still downloading from iCloud.
/// A file with no extension opens only when its first bytes pass the same check as at import (`sniff_extensionless`).
pub fn reference_open_path(root: &Path, rel: &str) -> Result<PathBuf> {
    let path = reference_path(root, rel)?;
    let ext = extension(rel).map_err(|_| ProjectError::UnsupportedReference { name: rel.to_string() })?;
    if BLOCKED.contains(&ext.as_str()) || ext == "svg" {
        return Err(ProjectError::UnsupportedReference { name: rel.to_string() });
    }
    if icloud_pending(&path) {
        return Err(ProjectError::IcloudPending { path: rel.to_string() });
    }
    let (file, _) = open_regular(root, rel)?;
    if ext.is_empty() {
        // No extension: the operating system would decide by content, so only content that is plainly a document or
        // media opens; a program, a script or unknown bytes stay refused. The read is capped and the handle is a regular file.
        let mut header = Vec::new();
        file.take(HEADER_BYTES as u64).read_to_end(&mut header).ctx(rel)?;
        if !sniff_extensionless(&header) {
            return Err(ProjectError::UnsupportedReference { name: rel.to_string() });
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests;

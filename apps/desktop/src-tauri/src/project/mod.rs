//! Reads and writes a CadabraCraft project folder. All paths are relative to the project root.
//! Manifest parsing and migration live in `@cadabracraft/format` (TypeScript); this layer only does safe file IO.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub const MANIFEST: &str = "cadabra.json";
const DIRS: [&str; 6] = ["manuscript", "front-matter", "back-matter", "assets", "exports", ".cadabra"];

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

/// Joins `rel` onto `root`, refusing absolute paths, `..`, and anything that would leave the project.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    let ok = !rel.is_empty() && !rel.contains('\\') && p.components().all(|c| matches!(c, Component::Normal(_)));
    if !ok {
        return Err(format!("unsafe project path: {rel}"));
    }
    Ok(root.join(p))
}

/// Write to a temp file in the same directory, then rename, so a crash or sync never leaves a half-written file.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("no parent dir")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{}.tmp", path.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn stamp() -> String {
    chrono::Utc::now().format("%Y%m%d-%H%M").to_string()
}

/// Creates the folder layout and writes the manifest. Refuses to touch an existing project.
pub fn create_project(root: &Path, manifest_json: &str) -> Result<(), String> {
    if root.join(MANIFEST).exists() {
        return Err("a project already exists in this folder".into());
    }
    for d in DIRS {
        fs::create_dir_all(root.join(d)).map_err(|e| e.to_string())?;
    }
    atomic_write(&root.join(MANIFEST), manifest_json.as_bytes())
}

/// Reads a project file. Returns None if it does not exist. A cloud placeholder that is not downloaded yet
/// is an error, never an empty file.
pub fn read_file(root: &Path, rel: &str) -> Result<Option<FileRead>, String> {
    let path = resolve(root, rel)?;
    match fs::read(&path) {
        Ok(bytes) => {
            let hash = hash_bytes(&bytes);
            let contents = String::from_utf8(bytes).map_err(|_| format!("{rel} is not valid UTF-8"))?;
            Ok(Some(FileRead { contents, hash }))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if path.with_file_name(format!(".{name}.icloud")).exists() {
                return Err(format!("{rel} is still downloading from iCloud; try again in a moment"));
            }
            Ok(None)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// `<dir>/<stem>.conflict-YYYYMMDD-HHMM[-N].<ext>` for the first name not already taken, so a second conflict in the
/// same minute never overwrites the first kept copy. Only the file name is split at its last dot, never the directory.
fn free_conflict_name(root: &Path, rel: &str) -> Result<String, String> {
    let (dir, name) = rel.rsplit_once('/').unwrap_or(("", rel));
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let ext = if ext.is_empty() { String::new() } else { format!(".{ext}") };
    let stamp = stamp();
    for n in 1u32.. {
        let suffix = if n == 1 { String::new() } else { format!("-{n}") };
        let file = format!("{stem}.conflict-{stamp}{suffix}{ext}");
        let copy = if dir.is_empty() { file } else { format!("{dir}/{file}") };
        if !resolve(root, &copy)?.exists() {
            return Ok(copy);
        }
    }
    unreachable!()
}

/// Writes a project file. If `base_hash` is given and the file on disk no longer matches it (it changed outside
/// the app, e.g. through sync), the on-disk version is kept as `<name>.conflict-YYYYMMDD-HHMM.<ext>` first.
pub fn write_file(root: &Path, rel: &str, contents: &str, base_hash: Option<&str>) -> Result<WriteResult, String> {
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
pub fn write_bytes(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    atomic_write(&resolve(root, rel)?, bytes)
}

/// Copies the manifest into `.cadabra/backups/` before a migration rewrites it. Returns the backup's relative path.
pub fn backup_manifest(root: &Path) -> Result<String, String> {
    let rel = format!(".cadabra/backups/cadabra-{}.json", stamp());
    let bytes = fs::read(root.join(MANIFEST)).map_err(|e| e.to_string())?;
    atomic_write(&resolve(root, &rel)?, &bytes)?;
    Ok(rel)
}

/// "Deletes" a file by moving it to `.cadabra/trash/`. Nothing is permanently removed by the app.
pub fn trash_file(root: &Path, rel: &str) -> Result<String, String> {
    let from = resolve(root, rel)?;
    if !from.exists() {
        return Err(format!("{rel} does not exist"));
    }
    let name = rel.replace('/', "__");
    let to_rel = format!(".cadabra/trash/{}-{name}", stamp());
    let to = resolve(root, &to_rel)?;
    fs::create_dir_all(to.parent().ok_or("no parent")?).map_err(|e| e.to_string())?;
    fs::rename(from, to).map_err(|e| e.to_string())?;
    Ok(to_rel)
}

/// Image types that may be imported into `assets/`.
pub const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
/// Largest image accepted, in bytes.
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

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
pub fn import_image(root: &Path, source: &Path) -> Result<String, String> {
    let file_name = source.file_name().and_then(|n| n.to_str()).ok_or("invalid file name")?;
    image_ext(file_name).ok_or_else(|| format!("unsupported image type: {file_name}"))?;
    let meta = fs::metadata(source).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("{file_name} is not a file"));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!("{file_name} is larger than {} MB", MAX_IMAGE_BYTES / 1024 / 1024));
    }
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    store_image(root, file_name, &bytes)
}

/// Validates image bytes (allowlisted extension, size, signature) and stores them in `assets/` under a sanitized,
/// de-duplicated name. Shared by the file picker import and the document importer, so both follow the same rules.
pub fn store_image(root: &Path, file_name: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = image_ext(file_name).ok_or_else(|| format!("unsupported image type: {file_name}"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(format!("{file_name} is larger than {} MB", MAX_IMAGE_BYTES / 1024 / 1024));
    }
    if !looks_like(&ext, bytes) {
        return Err(format!("{file_name} is not a valid {ext} image"));
    }
    let stem = sanitize_asset_stem(file_name.rsplit_once('.').map_or(file_name, |(s, _)| s));
    let hash = hash_bytes(bytes);
    for n in 1u32.. {
        let name = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem}-{n}.{ext}") };
        let rel = format!("assets/{name}");
        let path = resolve(root, &rel)?;
        match fs::read(&path) {
            Ok(existing) if hash_bytes(&existing) == hash => return Ok(rel),
            Ok(_) => continue,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                atomic_write(&path, bytes)?;
                return Ok(rel);
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    unreachable!()
}

/// Reads an asset's bytes for display. Only `assets/<image>` paths are served.
pub fn read_asset(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    if !rel.starts_with("assets/") || image_ext(rel).is_none() {
        return Err(format!("not an image asset: {rel}"));
    }
    let path = resolve(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| format!("{rel}: {e}"))?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!("{rel} is too large"));
    }
    fs::read(&path).map_err(|e| format!("{rel}: {e}"))
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
        assert!(read_file(d.path(), "manuscript/x.json").unwrap_err().contains("iCloud"));
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
        assert!(import_image(proj.path(), &src(&out, "x.exe", &PNG)).unwrap_err().contains("unsupported"));
        assert!(import_image(proj.path(), &src(&out, "noext", &PNG)).is_err());
        assert!(import_image(proj.path(), &src(&out, "fake.png", b"not an image")).unwrap_err().contains("not a valid"));
        assert!(import_image(proj.path(), &out.path().join("missing.png")).is_err());
        let dir = out.path().join("d.png");
        fs::create_dir(&dir).unwrap();
        assert!(import_image(proj.path(), &dir).unwrap_err().contains("not a file"));
        let big = out.path().join("big.png");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(import_image(proj.path(), &big).unwrap_err().contains("larger"));
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
        assert!(store_image(proj.path(), "x.exe", &PNG).unwrap_err().contains("unsupported"));
        assert!(store_image(proj.path(), "x.png", b"nope").unwrap_err().contains("not a valid"));
        let big = vec![0u8; MAX_IMAGE_BYTES as usize + 1];
        assert!(store_image(proj.path(), "big.png", &big).unwrap_err().contains("larger"));
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
}

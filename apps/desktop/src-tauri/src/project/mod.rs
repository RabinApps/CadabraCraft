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

/// Writes a project file. If `base_hash` is given and the file on disk no longer matches it (it changed outside
/// the app, e.g. through sync), the on-disk version is kept as `<name>.conflict-YYYYMMDD-HHMM.<ext>` first.
pub fn write_file(root: &Path, rel: &str, contents: &str, base_hash: Option<&str>) -> Result<WriteResult, String> {
    let path = resolve(root, rel)?;
    let mut conflict_copy = None;
    if let (Some(base), Ok(existing)) = (base_hash, fs::read(&path)) {
        if hash_bytes(&existing) != base {
            let (stem, ext) = rel.rsplit_once('.').unwrap_or((rel, ""));
            let copy = format!("{stem}.conflict-{}{}{ext}", stamp(), if ext.is_empty() { "" } else { "." });
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
}

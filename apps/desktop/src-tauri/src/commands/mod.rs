use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

/// M0 spike: all paths are relative to ~/Documents/CadabraCraft-spike. M1 replaces this with real project roots.
fn resolve(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("path must be relative and stay inside the spike folder".into());
    }
    let base = dirs::document_dir().ok_or("no documents dir")?.join("CadabraCraft-spike");
    Ok(base.join(p))
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

#[tauri::command]
pub fn load_chapter(path: String) -> Result<Option<serde_json::Value>, String> {
    let p = resolve(&path)?;
    match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(|e| format!("invalid chapter JSON: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_chapter(path: String, doc: serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
    atomic_write(&resolve(&path)?, &bytes)
}

#[tauri::command]
pub fn save_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    atomic_write(&resolve(&path)?, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.json");
        atomic_write(&p, b"one").unwrap();
        atomic_write(&p, b"two").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn rejects_escaping_paths() {
        assert!(resolve("../x").is_err());
        assert!(resolve("/etc/passwd").is_err());
    }
}

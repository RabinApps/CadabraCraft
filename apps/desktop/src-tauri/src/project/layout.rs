//! The project folder layout: creating a project and backing up its manifest.
use super::fsio::{atomic_write, read_regular, stamp};
use super::paths::resolve;
use super::{ProjectError, Result};
use std::fs;
use std::path::Path;

pub const MANIFEST: &str = "cadabra.json";
/// Largest manifest `create_project` accepts, in bytes (a real one is a few KB).
pub const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const DIRS: [&str; 7] = ["manuscript", "front-matter", "back-matter", "assets", "references", "exports", ".cadabra"];

/// Creates the folder layout and writes the manifest. Refuses to touch an existing project.
/// The manifest must be at most `MAX_MANIFEST_BYTES` and a JSON object; this is checked before anything is created.
pub fn create_project(root: &Path, manifest_json: &str) -> Result<()> {
    check_manifest(manifest_json)?;
    if root.join(MANIFEST).exists() {
        return Err(ProjectError::AlreadyExists);
    }
    for d in DIRS {
        fs::create_dir_all(root.join(d))?;
    }
    atomic_write(&resolve(root, MANIFEST)?, manifest_json.as_bytes())
}

fn check_manifest(manifest_json: &str) -> Result<()> {
    if manifest_json.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(manifest_too_large());
    }
    match serde_json::from_str::<serde_json::Value>(manifest_json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(ProjectError::InvalidManifest),
    }
}

fn manifest_too_large() -> ProjectError {
    ProjectError::TooLarge { path: MANIFEST.to_string(), max_mb: MAX_MANIFEST_BYTES / 1024 / 1024 }
}

/// Copies the manifest into `.cadabra/backups/` before a migration rewrites it. Returns the backup's relative path.
pub fn backup_manifest(root: &Path) -> Result<String> {
    let rel = format!(".cadabra/backups/cadabra-{}.json", stamp());
    let bytes = read_regular(&resolve(root, MANIFEST)?, MAX_MANIFEST_BYTES, MANIFEST, manifest_too_large)?;
    atomic_write(&resolve(root, &rel)?, &bytes)?;
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
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
    fn create_twice_reports_already_exists() {
        let d = tmp();
        create_project(d.path(), "{}").unwrap();
        assert_eq!(create_project(d.path(), "{}").unwrap_err(), ProjectError::AlreadyExists);
    }

    #[test]
    fn the_manifest_must_be_a_json_object_within_the_cap() {
        let d = tmp();
        for bad in ["", "nope", "[]", "1", "null", "\"s\""] {
            assert_eq!(create_project(d.path(), bad), Err(ProjectError::InvalidManifest), "{bad:?}");
        }
        assert!(!d.path().join(MANIFEST).exists() && !d.path().join("assets").exists(), "nothing is created for a refused manifest");
        let pad = |n: usize| format!("{{\"a\":\"{}\"}}", "x".repeat(n - 8));
        assert_eq!(pad(MAX_MANIFEST_BYTES as usize + 1).len() as u64, MAX_MANIFEST_BYTES + 1);
        assert_eq!(create_project(d.path(), &pad(MAX_MANIFEST_BYTES as usize + 1)), Err(ProjectError::TooLarge { path: "cadabra.json".into(), max_mb: 1 }));
        create_project(d.path(), &pad(MAX_MANIFEST_BYTES as usize)).unwrap();
    }

    #[test]
    fn backing_up_refuses_a_manifest_over_the_cap() {
        let d = tmp();
        create_project(d.path(), "{}").unwrap();
        fs::File::create(d.path().join(MANIFEST)).unwrap().set_len(MAX_MANIFEST_BYTES + 1).unwrap();
        assert!(matches!(backup_manifest(d.path()), Err(ProjectError::TooLarge { .. })));
        fs::write(d.path().join(MANIFEST), "{}").unwrap();
        let rel = backup_manifest(d.path()).unwrap();
        assert_eq!(fs::read_to_string(d.path().join(rel)).unwrap(), "{}");
    }
}

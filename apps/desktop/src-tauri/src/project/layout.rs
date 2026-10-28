//! The project folder layout: creating a project and backing up its manifest.
use super::fsio::{atomic_write, stamp};
use super::paths::resolve;
use super::{ProjectError, Result};
use std::fs;
use std::path::Path;

pub const MANIFEST: &str = "cadabra.json";
const DIRS: [&str; 6] = ["manuscript", "front-matter", "back-matter", "assets", "exports", ".cadabra"];

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

/// Copies the manifest into `.cadabra/backups/` before a migration rewrites it. Returns the backup's relative path.
pub fn backup_manifest(root: &Path) -> Result<String> {
    let rel = format!(".cadabra/backups/cadabra-{}.json", stamp());
    let bytes = fs::read(resolve(root, MANIFEST)?)?;
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
}

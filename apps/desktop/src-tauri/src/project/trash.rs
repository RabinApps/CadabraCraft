//! "Deleting" pages by moving them to `.cadabra/trash/`, and restoring them.
use super::fsio::stamp;
use super::paths::{free_name, resolve};
use super::{ProjectError, Result};
use serde::Serialize;
use std::fs;
use std::path::Path;

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
pub(super) fn parse_trash_name(name: &str) -> Option<(String, String)> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::*;

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
}

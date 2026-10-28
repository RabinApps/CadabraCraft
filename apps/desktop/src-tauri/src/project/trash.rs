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
    // Only chapter pages can be trashed (and later restored): not the manifest, assets, exports or whole folders.
    if !is_page_path(rel) {
        return Err(ProjectError::CannotRestore { path: rel.to_string() });
    }
    match from.symlink_metadata() {
        Err(_) => return Err(ProjectError::NotFound { path: rel.to_string() }),
        Ok(m) if !m.is_file() => return Err(ProjectError::NotAFile { path: rel.to_string() }),
        Ok(_) => {}
    }
    let name = rel.replace('/', "__");
    let to_rel = free_name(root, &format!(".cadabra/trash/{}-{name}", stamp()))?;
    let to = resolve(root, &to_rel)?;
    fs::create_dir_all(to.parent().ok_or(ProjectError::InvalidFileName)?)?;
    fs::rename(from, to)?;
    Ok(to_rel)
}

/// `manuscript|front-matter|back-matter/<name>.json`, optionally one language folder deeper.
fn is_page_path(rel: &str) -> bool {
    let mut parts = rel.split('/');
    let dir_ok = parts.next().is_some_and(|d| RESTORE_DIRS.contains(&d));
    let rest: Vec<&str> = parts.collect();
    dir_ok && (1..=2).contains(&rest.len()) && rest.iter().all(|p| !p.is_empty()) && rest.last().is_some_and(|f| f.ends_with(".json"))
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
/// `manuscript__a__b.json` restores to `manuscript/a__b.json`. A translation lives one folder deeper
/// (`manuscript/fr/001-a.json`, flattened `manuscript__fr__001-a.json`): when the part after the folder looks like a
/// language code (2 or 3 letters, then optional `-subtags`) and a file name follows, it is that language's folder.
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
    if !RESTORE_DIRS.contains(&dir) || file.is_empty() || file.contains('/') {
        return None;
    }
    let stamp = name[..13].to_string();
    match file.split_once("__") {
        Some((lang, rest)) if is_language_folder(lang) && !rest.is_empty() => Some((stamp, format!("{dir}/{lang}/{rest}"))),
        _ => Some((stamp, format!("{dir}/{file}"))),
    }
}

/// A translation folder name: 2 or 3 ASCII letters, then optional `-` subtags (`fr`, `pt-BR`, `zh-Hant`).
fn is_language_folder(s: &str) -> bool {
    let mut parts = s.split('-');
    let first = parts.next().unwrap_or("");
    (2..=3).contains(&first.len()) && first.bytes().all(|b| b.is_ascii_alphabetic()) && parts.all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric()))
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
    fn a_translation_file_round_trips_through_the_trash() {
        let d = tmp();
        write_file(d.path(), "manuscript/fr/001-a.json", "A", None).unwrap();
        let t = trash_file(d.path(), "manuscript/fr/001-a.json").unwrap();
        assert!(t.ends_with("-manuscript__fr__001-a.json"));
        assert_eq!(list_trash(d.path()).unwrap()[0].original, "manuscript/fr/001-a.json");
        assert_eq!(restore_trash(d.path(), &t).unwrap(), "manuscript/fr/001-a.json");
        assert_eq!(fs::read_to_string(d.path().join("manuscript/fr/001-a.json")).unwrap(), "A");
    }

    #[test]
    fn a_double_underscore_in_a_source_file_name_is_not_a_language() {
        assert_eq!(parse_trash_name("20260101-1200-manuscript__a__b.json").unwrap().1, "manuscript/a__b.json");
        assert_eq!(parse_trash_name("20260101-1200-manuscript__pt-BR__01-x.json").unwrap().1, "manuscript/pt-BR/01-x.json");
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
    fn only_page_files_can_be_trashed() {
        let d = tmp();
        create_project(d.path(), "{}").unwrap();
        write_file(d.path(), "manuscript/001-a.json", "A", None).unwrap();
        fs::create_dir_all(d.path().join("assets")).unwrap();
        fs::write(d.path().join("assets/a.png"), "x").unwrap();
        for bad in ["cadabra.json", "assets/a.png", "manuscript", "manuscript/", "manuscript/a/b/c.json", "manuscript/001-a.txt", ".cadabra/trash/x.json"] {
            assert!(matches!(trash_file(d.path(), bad), Err(ProjectError::CannotRestore { .. } | ProjectError::UnsafePath { .. })), "{bad}");
        }
        assert!(d.path().join("cadabra.json").is_file() && d.path().join("assets/a.png").is_file());
        // A folder with a page-like name is not a file.
        fs::create_dir_all(d.path().join("manuscript/dir.json")).unwrap();
        assert_eq!(trash_file(d.path(), "manuscript/dir.json").unwrap_err(), ProjectError::NotAFile { path: "manuscript/dir.json".into() });
        assert!(d.path().join("manuscript/dir.json").is_dir());
    }

    #[test]
    fn trash_and_restore_report_typed_errors() {
        let d = tmp();
        assert_eq!(trash_file(d.path(), "manuscript/nope.json").unwrap_err(), ProjectError::NotFound { path: "manuscript/nope.json".into() });
        assert!(matches!(restore_trash(d.path(), "manuscript/a.json").unwrap_err(), ProjectError::NotTrashPath { .. }));
        assert!(matches!(restore_trash(d.path(), ".cadabra/trash/x.json").unwrap_err(), ProjectError::CannotRestore { .. }));
    }

    #[test]
    fn listing_without_a_trash_folder_is_empty_and_skips_folders_and_reports_a_file_in_the_way() {
        let d = tmp();
        assert!(list_trash(d.path()).unwrap().is_empty());
        fs::create_dir_all(d.path().join(".cadabra/trash/a-folder")).unwrap();
        assert!(list_trash(d.path()).unwrap().is_empty());
        let e = tmp();
        fs::create_dir_all(e.path().join(".cadabra")).unwrap();
        fs::write(e.path().join(".cadabra/trash"), "a file").unwrap();
        assert!(matches!(list_trash(e.path()), Err(ProjectError::Io { .. })));
    }
}

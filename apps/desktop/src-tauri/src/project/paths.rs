//! Project-relative path resolution and the guards that keep every command inside a project folder.
use super::layout::MANIFEST;
use super::{ProjectError, Result};
use std::fs;
use std::path::{Component, Path, PathBuf};

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

/// Joins `rel` onto `root`, refusing empty, absolute and `..` paths, backslashes, colons, NUL bytes, and anything that
/// would leave the project through a symbolic link. Colons are refused on every OS so a project behaves the same
/// everywhere: on Windows `C:` is a drive prefix and `name:stream` is an NTFS alternate data stream.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel);
    let ok = !rel.is_empty() && !rel.contains(['\\', ':', '\0']) && p.components().all(|c| matches!(c, Component::Normal(_)));
    if !ok {
        return Err(ProjectError::UnsafePath { path: rel.to_string() });
    }
    let abs = root.join(p);
    ensure_contained(root, &abs, rel)?;
    Ok(abs)
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

/// `<dir>/<stem>-N.<ext>` for the first N >= 2 not taken (or `rel` itself when free). Only the file name is split.
pub(crate) fn free_name(root: &Path, rel: &str) -> Result<String> {
    free_name_with(root, rel, '-')
}

/// Like `free_name` for backup and trash copies: the counter follows `~` (`<stamp>-<flat>~2.json`), a character page
/// names never hold, so a counted copy of `a.json` cannot be mistaken for a copy of a page called `a-2.json`.
pub(crate) fn free_copy_name(root: &Path, rel: &str) -> Result<String> {
    free_name_with(root, rel, '~')
}

fn free_name_with(root: &Path, rel: &str, sep: char) -> Result<String> {
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
        let cand = format!("{stem}{sep}{n}{ext}");
        if !resolve(root, &cand)?.exists() {
            return Ok(cand);
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::*;
    use std::path::Path;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn resolve_rejects_escapes() {
        let r = Path::new("/p");
        for bad in ["../x", "/etc/passwd", "a/../../b", "", "a\\b", "./x", "C:/x", "a.json:stream"] {
            assert!(resolve(r, bad).is_err(), "{bad}");
        }
        assert_eq!(resolve(r, "manuscript/001-a.json").unwrap(), Path::new("/p/manuscript/001-a.json"));
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
    fn free_name_handles_names_without_an_extension_and_skips_taken_numbers() {
        let d = tmp();
        assert_eq!(free_name(d.path(), "notes").unwrap(), "notes");
        fs::write(d.path().join("notes"), "").unwrap();
        assert_eq!(free_name(d.path(), "notes").unwrap(), "notes-2");
        fs::write(d.path().join("notes-2"), "").unwrap();
        assert_eq!(free_name(d.path(), "notes").unwrap(), "notes-3");
        fs::write(d.path().join("a.json"), "").unwrap();
        fs::write(d.path().join("a-2.json"), "").unwrap();
        assert_eq!(free_name(d.path(), "a.json").unwrap(), "a-3.json");
        assert_eq!(free_copy_name(d.path(), "a.json").unwrap(), "a~2.json");
    }

    #[cfg(unix)]
    #[test]
    fn containment_walks_up_to_the_top_of_a_relative_path_and_reports_unreadable_folders() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        assert!(ensure_contained(d.path(), Path::new("no-such-top/x/y"), "x/y").is_ok(), "nothing exists, so no link to follow");
        let locked = d.path().join("locked");
        fs::create_dir(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let result = resolve(d.path(), "locked/page.json");
        let denied = fs::read_dir(&locked).is_err(); // false when running as root
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!denied || matches!(result, Err(ProjectError::Io { .. })));
    }
}

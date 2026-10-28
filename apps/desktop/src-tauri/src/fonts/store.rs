//! What is installed under the fonts folder: listing, deleting and reading font files. Ids and file names that reach
//! this layer come from the webview, so they are checked before they become part of a path.
use super::catalog::{find_family, FAMILIES};
use super::error::{io_err, FontError};
use super::import::{family_name, read_font};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Folder (under the fonts folder) and id prefix of imported families.
pub const IMPORTED_DIR: &str = "imported";
pub const IMPORTED_PREFIX: &str = "imported-";

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Downloaded,
    Imported,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct InstalledFont {
    pub id: String,
    pub family: String,
    pub source: Source,
    /// File names inside the family's folder (never paths).
    pub files: Vec<String>,
}

fn unknown(id: &str) -> FontError {
    FontError::UnknownFont {
        font: id.to_string(),
    }
}

/// A single path segment: not empty, no separators, no NUL, not `.` or `..` and no `..` anywhere.
pub fn is_safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 255
        && !s.contains(['/', '\\', '\0'])
        && !s.contains("..")
        && s != "."
}

fn is_font_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !name.starts_with('.') && (lower.ends_with(".ttf") || lower.ends_with(".otf"))
}

/// The folder of an installed (or installable) family: a catalog id is `<root>/<id>`, an imported one is
/// `<root>/imported/<slug>`. Anything else is an unknown font.
pub fn family_dir(root: &Path, id: &str) -> Result<PathBuf, FontError> {
    if !is_safe_segment(id) {
        return Err(unknown(id));
    }
    if let Some(slug) = id.strip_prefix(IMPORTED_PREFIX) {
        return if is_safe_segment(slug) {
            Ok(root.join(IMPORTED_DIR).join(slug))
        } else {
            Err(unknown(id))
        };
    }
    find_family(id)
        .map(|f| root.join(f.id))
        .ok_or_else(|| unknown(id))
}

/// The font files of a folder, sorted. None when there are none (or the folder is missing).
fn font_files(dir: &Path) -> Vec<String> {
    let mut files: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| is_font_file(n))
        .collect();
    files.sort();
    files
}

pub(crate) fn installed_in(
    dir: &Path,
    id: String,
    family: String,
    source: Source,
) -> Option<InstalledFont> {
    let files = font_files(dir);
    (!files.is_empty()).then_some(InstalledFont {
        id,
        family,
        source,
        files,
    })
}

/// Downloaded families (complete ones only, as the catalog defines it) and imported ones.
pub fn list_installed(root: Option<&Path>) -> Vec<InstalledFont> {
    let Some(root) = root else { return Vec::new() };
    let mut out: Vec<InstalledFont> = FAMILIES
        .iter()
        .filter(|f| f.installed(root))
        .map(|f| InstalledFont {
            id: f.id.into(),
            family: f.family.into(),
            source: Source::Downloaded,
            files: f.files.iter().map(|x| x.name.to_string()).collect(),
        })
        .collect();
    let mut imported: Vec<PathBuf> = fs::read_dir(root.join(IMPORTED_DIR))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .collect();
    imported.sort();
    for dir in imported {
        let Some(slug) = dir
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|n| is_safe_segment(n))
            .map(str::to_string)
        else {
            continue;
        };
        let files = font_files(&dir);
        // The family is read from the first file that still parses; a folder with none is not a font.
        let family = files.iter().find_map(|f| {
            read_font(&dir.join(f))
                .ok()
                .and_then(|b| family_name(&b).ok())
        });
        if let Some(family) = family {
            out.push(InstalledFont {
                id: format!("{IMPORTED_PREFIX}{slug}"),
                family,
                source: Source::Imported,
                files,
            });
        }
    }
    out
}

/// Removes a family's folder (including partial downloads). A catalog family that is not installed is fine; an
/// imported id that does not exist is an unknown font.
pub fn delete_font(root: &Path, id: &str) -> Result<(), FontError> {
    let dir = family_dir(root, id)?;
    match fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if id.starts_with(IMPORTED_PREFIX) {
                Err(unknown(id))
            } else {
                Ok(())
            }
        }
        Err(e) => Err(io_err(e)),
    }
}

/// The bytes of one installed font file, for the editor's `@font-face`.
pub fn read_font_file(root: &Path, id: &str, file: &str) -> Result<Vec<u8>, FontError> {
    let dir = family_dir(root, id)?;
    if !is_safe_segment(file) || !is_font_file(file) {
        return Err(unknown(&format!("{id}/{file}")));
    }
    let path = dir.join(file);
    if !fs::symlink_metadata(&path).is_ok_and(|m| m.is_file()) {
        return Err(unknown(&format!("{id}/{file}")));
    }
    read_font(&path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fonts::import::{import_font, tests::ttf};

    #[test]
    fn segments_with_separators_dots_or_nothing_are_refused() {
        for bad in [
            "", ".", "..", "a/b", "a\\b", "../x", "x/..", "a..b", "/abs", "a\0b", "..\\x",
        ] {
            assert!(!is_safe_segment(bad), "{bad:?}");
        }
        for good in ["lora", "imported-a-b", "Lora-VF.ttf", "a.b.ttf"] {
            assert!(is_safe_segment(good), "{good}");
        }
        assert!(!is_safe_segment(&"a".repeat(256)));
    }

    #[test]
    fn a_family_folder_comes_only_from_the_catalog_or_the_imported_prefix() {
        let root = Path::new("/r");
        assert_eq!(family_dir(root, "lora").unwrap(), root.join("lora"));
        assert_eq!(
            family_dir(root, "imported-my-font").unwrap(),
            root.join("imported/my-font")
        );
        for bad in [
            "nope",
            "imported",
            "imported-",
            "imported-../x",
            "imported-a/b",
            "../lora",
            "lora/..",
            "imported/my-font",
            "",
        ] {
            assert!(
                matches!(family_dir(root, bad), Err(FontError::UnknownFont { .. })),
                "{bad:?}"
            );
        }
    }

    fn install_catalog(root: &Path, id: &str) {
        let f = find_family(id).unwrap();
        let dir = root.join(id);
        fs::create_dir_all(&dir).unwrap();
        for file in f.files.iter().chain(std::iter::once(&f.licence)) {
            fs::write(dir.join(file.name), vec![0u8; file.size as usize]).unwrap();
        }
    }

    #[test]
    fn listing_has_complete_downloads_and_imports_with_their_family_names() {
        assert!(list_installed(None).is_empty());
        let (root, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        assert!(list_installed(Some(root.path())).is_empty());
        install_catalog(root.path(), "cardo");
        // a half-installed family is not listed
        let lato = root.path().join("lato");
        fs::create_dir_all(&lato).unwrap();
        fs::write(lato.join("Lato-Regular.ttf"), b"x").unwrap();
        fs::write(src.path().join("a.ttf"), ttf("My Font")).unwrap();
        import_font(&src.path().join("a.ttf"), root.path()).unwrap();
        // junk in the imported folder is ignored
        fs::create_dir_all(root.path().join("imported/junk")).unwrap();
        fs::write(root.path().join("imported/junk/x.ttf"), b"not a font").unwrap();
        fs::write(root.path().join("imported/stray.txt"), b"x").unwrap();
        let list = list_installed(Some(root.path()));
        assert_eq!(
            list.iter()
                .map(|f| (f.id.as_str(), f.family.as_str(), f.source))
                .collect::<Vec<_>>(),
            vec![
                ("cardo", "Cardo", Source::Downloaded),
                ("imported-my-font", "My Font", Source::Imported)
            ]
        );
        assert_eq!(
            list[0].files,
            vec!["Cardo-Regular.ttf", "Cardo-Italic.ttf", "Cardo-Bold.ttf"]
        );
        assert_eq!(list[1].files, vec!["a.ttf"]);
        let v = serde_json::to_value(&list[1]).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "id": "imported-my-font", "family": "My Font", "source": "imported", "files": ["a.ttf"] })
        );
    }

    #[test]
    fn deleting_removes_the_folder_and_refuses_bad_ids() {
        let (root, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        install_catalog(root.path(), "cardo");
        fs::write(root.path().join("cardo/half.ttf.part"), b"x").unwrap();
        delete_font(root.path(), "cardo").unwrap();
        assert!(!root.path().join("cardo").exists());
        delete_font(root.path(), "cardo").unwrap(); // already gone
        fs::write(src.path().join("a.ttf"), ttf("My Font")).unwrap();
        import_font(&src.path().join("a.ttf"), root.path()).unwrap();
        delete_font(root.path(), "imported-my-font").unwrap();
        assert!(!root.path().join("imported/my-font").exists());
        assert!(
            root.path().join("imported").exists(),
            "only the family goes"
        );
        assert!(matches!(
            delete_font(root.path(), "imported-my-font"),
            Err(FontError::UnknownFont { .. })
        ));
        for bad in ["..", "../cardo", "a/b", "nope", ""] {
            assert!(
                matches!(
                    delete_font(root.path(), bad),
                    Err(FontError::UnknownFont { .. })
                ),
                "{bad:?}"
            );
        }
        assert!(root.path().exists());
    }

    #[test]
    fn reading_a_file_checks_both_names_and_only_serves_font_files() {
        let (root, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        install_catalog(root.path(), "cardo");
        fs::write(src.path().join("a.ttf"), ttf("My Font")).unwrap();
        import_font(&src.path().join("a.ttf"), root.path()).unwrap();
        assert_eq!(
            read_font_file(root.path(), "imported-my-font", "a.ttf").unwrap(),
            ttf("My Font")
        );
        assert_eq!(
            read_font_file(root.path(), "cardo", "Cardo-Bold.ttf")
                .unwrap()
                .len(),
            find_family("cardo").unwrap().files[2].size as usize
        );
        for (id, file) in [
            ("cardo", "OFL.txt"),
            ("cardo", "../lato/x.ttf"),
            ("cardo", "a/b.ttf"),
            ("cardo", ".."),
            ("cardo", ""),
            ("cardo", "..\\a.ttf"),
            ("cardo", "Missing.ttf"),
            ("..", "a.ttf"),
            ("nope", "a.ttf"),
            ("imported-my-font", "../../cardo/Cardo-Bold.ttf"),
            ("cardo", "x.ttf.part"),
        ] {
            assert!(
                matches!(
                    read_font_file(root.path(), id, file),
                    Err(FontError::UnknownFont { .. })
                ),
                "{id} {file}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_not_served() {
        let (root, outside) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(outside.path().join("secret.ttf"), b"secret").unwrap();
        fs::create_dir_all(root.path().join("imported/x")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.ttf"),
            root.path().join("imported/x/link.ttf"),
        )
        .unwrap();
        assert!(matches!(
            read_font_file(root.path(), "imported-x", "link.ttf"),
            Err(FontError::UnknownFont { .. })
        ));
    }
}

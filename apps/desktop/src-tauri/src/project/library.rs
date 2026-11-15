//! The Library's folder scan and asset stamp. A scan reads each `cadabra.json` it finds and nothing else (no chapter, no asset),
//! so a folder of hundreds of books lists quickly and a book's words stay unknown until it is opened.
use super::assets::{image_ext, image_too_large};
use super::fsio::read_regular;
use super::layout::MAX_MANIFEST_BYTES;
use super::paths::resolve;
use super::{io_error, ProjectError, Result, MANIFEST};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Folders below the picked one that are searched (the picked folder is level 0): `Books/Series/Book1/cadabra.json` is found.
const MAX_DEPTH: usize = 3;
/// Most books a scan returns; a scan stops there and says so.
pub const MAX_SCANNED: usize = 1000;
/// Most folders a scan looks into, so a scan of a home folder cannot walk a whole disk.
const MAX_FOLDERS: usize = 20_000;

/// What a manifest says about its book. Absent text is `None`; nothing here needs a chapter.
#[derive(Serialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScannedBook {
    pub root: String,
    pub title: String,
    pub author: String,
    pub language: String,
    pub cover: Option<String>,
    pub series: Option<String>,
    pub series_number: Option<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScan {
    pub books: Vec<ScannedBook>,
    /// Folders with a `cadabra.json` that could not be read as a book (broken JSON, no edition, too large).
    pub skipped: usize,
    /// True when the scan stopped at a limit, so the list may be incomplete.
    pub truncated: bool,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().map(str::to_owned).filter(|s| !s.is_empty())
}

/// The book a manifest describes: its first (source) edition.
fn read_book(dir: &Path) -> Result<ScannedBook> {
    let path = dir.join(MANIFEST);
    let bytes =
        read_regular(&path, MAX_MANIFEST_BYTES, MANIFEST, || ProjectError::TooLarge { path: MANIFEST.into(), max_mb: MAX_MANIFEST_BYTES / 1024 / 1024 })?;
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|_| ProjectError::InvalidManifest)?;
    let edition = manifest.get("editions").and_then(|e| e.as_array()).and_then(|e| e.first()).ok_or(ProjectError::InvalidManifest)?;
    let publishing = edition.get("publishing").unwrap_or(&Value::Null);
    let series = text(publishing, "series");
    Ok(ScannedBook {
        root: dir.to_string_lossy().into_owned(),
        title: text(edition, "title").unwrap_or_default(),
        author: text(edition, "author").unwrap_or_default(),
        language: text(edition, "language").unwrap_or_default(),
        cover: text(edition, "cover").filter(|c| c.starts_with("assets/") && image_ext(c).is_some() && !c.contains("..")),
        series_number: series.as_ref().and_then(|_| text(publishing, "seriesNumber")),
        series,
    })
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// Finds the books under `root` (already a picked, canonical folder). A folder with a manifest is a book and is not searched
/// further; symbolic links are not followed (a link could lead out of the folder the author chose or loop); hidden folders
/// (`.cadabra`, `.git`) are skipped. Results are sorted by path so a scan is repeatable.
pub fn scan_library(root: &Path) -> Result<LibraryScan> {
    let meta = fs::metadata(root).map_err(|e| io_error(e, &root.to_string_lossy()))?;
    if !meta.is_dir() {
        return Err(ProjectError::NotAFile { path: root.to_string_lossy().into_owned() });
    }
    let mut scan = LibraryScan::default();
    let mut visited = 0usize;
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        visited += 1;
        if visited > MAX_FOLDERS {
            scan.truncated = true;
            break;
        }
        if fs::symlink_metadata(dir.join(MANIFEST)).is_ok_and(|m| m.is_file()) {
            match read_book(&dir) {
                Ok(book) if scan.books.len() < MAX_SCANNED => scan.books.push(book),
                Ok(_) => {
                    scan.truncated = true;
                    break;
                }
                Err(_) => scan.skipped += 1,
            }
            continue;
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        // An unreadable folder is not an error of the scan: it has no books we can list.
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // `file_type` does not follow links: a link to a folder is neither a dir nor a file here.
            if !is_hidden(&name) && entry.file_type().is_ok_and(|t| t.is_dir()) {
                stack.push((entry.path(), depth + 1));
            }
        }
    }
    scan.books.sort_by(|a, b| a.root.cmp(&b.root));
    Ok(scan)
}

/// Size and modification time of an asset, so a cached thumbnail can tell when the picture changed without reading it.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetStat {
    pub size: u64,
    /// Milliseconds since the Unix epoch (0 when the system does not say).
    pub modified: u64,
}

pub fn stat_asset(root: &Path, rel: &str) -> Result<AssetStat> {
    if !rel.starts_with("assets/") || image_ext(rel).is_none() {
        return Err(ProjectError::NotImageAsset { path: rel.to_string() });
    }
    let path = resolve(root, rel)?;
    let md = fs::metadata(&path).map_err(|e| io_error(e, rel))?;
    if !md.is_file() {
        return Err(ProjectError::NotAFile { path: rel.to_string() });
    }
    if md.len() > super::MAX_IMAGE_BYTES {
        return Err(image_too_large(rel));
    }
    let modified = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
    Ok(AssetStat { size: md.len(), modified })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book(dir: &Path, manifest: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(MANIFEST), manifest).unwrap();
    }

    const FULL: &str =
        r#"{"editions":[{"language":"en","title":"Moon","author":"Mara","cover":"assets/c.png","publishing":{"series":"Tides","seriesNumber":"2"}}]}"#;

    #[test]
    fn a_manifest_is_read_for_its_source_edition_only() {
        let d = tempfile::tempdir().unwrap();
        book(&d.path().join("moon"), FULL);
        let scan = scan_library(d.path()).unwrap();
        assert_eq!(scan.skipped, 0);
        let b = &scan.books[0];
        assert_eq!((b.title.as_str(), b.author.as_str(), b.language.as_str()), ("Moon", "Mara", "en"));
        assert_eq!((b.cover.as_deref(), b.series.as_deref(), b.series_number.as_deref()), (Some("assets/c.png"), Some("Tides"), Some("2")));
        assert!(b.root.ends_with("moon"));
    }

    #[test]
    fn broken_missing_and_oversized_manifests_are_skipped_not_fatal() {
        let d = tempfile::tempdir().unwrap();
        book(&d.path().join("ok"), FULL);
        book(&d.path().join("broken"), "{not json");
        book(&d.path().join("noeditions"), "{}");
        book(&d.path().join("empty-editions"), r#"{"editions":[]}"#);
        book(&d.path().join("big"), &format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_MANIFEST_BYTES as usize)));
        fs::create_dir_all(d.path().join("plain/inner")).unwrap(); // no manifest: not a book
        let scan = scan_library(d.path()).unwrap();
        assert_eq!(scan.books.len(), 1);
        assert_eq!(scan.skipped, 4);
        assert!(!scan.truncated);
    }

    #[test]
    fn a_manifest_that_is_a_folder_is_not_a_book() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("x").join(MANIFEST)).unwrap();
        let scan = scan_library(d.path()).unwrap();
        assert_eq!((scan.books.len(), scan.skipped), (0, 0));
    }

    #[test]
    fn nested_folders_are_searched_to_a_depth_and_a_book_is_not_searched_inside() {
        let d = tempfile::tempdir().unwrap();
        book(&d.path().join("Series/One"), FULL);
        book(&d.path().join("a/b/c"), FULL);
        book(&d.path().join("a/b/c/d/too-deep"), FULL); // inside a book: never reached
        book(&d.path().join("a/b/c2/d/e"), FULL); // deeper than MAX_DEPTH
        book(&d.path().join(".hidden/book"), FULL);
        book(&d.path().join("node_modules/book"), FULL);
        let roots: Vec<String> = scan_library(d.path()).unwrap().books.into_iter().map(|b| b.root).collect();
        assert_eq!(roots.len(), 2, "{roots:?}");
        assert!(roots[0].ends_with("Series/One") && roots[1].ends_with("a/b/c"), "sorted by path: {roots:?}");
    }

    #[test]
    fn the_picked_folder_may_itself_be_a_book() {
        let d = tempfile::tempdir().unwrap();
        book(d.path(), FULL);
        assert_eq!(scan_library(d.path()).unwrap().books.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_is_not_followed() {
        let (d, elsewhere) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        book(&elsewhere.path().join("secret"), FULL);
        std::os::unix::fs::symlink(elsewhere.path(), d.path().join("link")).unwrap();
        std::os::unix::fs::symlink(d.path(), d.path().join("loop")).unwrap();
        book(&d.path().join("real"), FULL);
        let scan = scan_library(d.path()).unwrap();
        assert_eq!(scan.books.len(), 1);
        assert!(scan.books[0].root.ends_with("real"));
    }

    #[test]
    fn a_cover_outside_assets_and_a_series_number_without_a_series_are_dropped() {
        let d = tempfile::tempdir().unwrap();
        book(&d.path().join("a"), r#"{"editions":[{"title":"A","cover":"../x.png","publishing":{"seriesNumber":"3"}}]}"#);
        book(&d.path().join("b"), r#"{"editions":[{"title":"B","cover":"assets/a.txt"}]}"#);
        book(&d.path().join("c"), r#"{"editions":[{"title":7,"cover":"assets/../x.png"}]}"#);
        let scan = scan_library(d.path()).unwrap();
        for b in &scan.books {
            assert!(b.cover.is_none() && b.series.is_none() && b.series_number.is_none(), "{b:?}");
        }
        assert_eq!(scan.books.len(), 3);
        assert_eq!(scan.books[2].title, "", "a title that is not text is empty");
    }

    #[test]
    fn a_scan_stops_at_the_book_limit_and_says_so() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..MAX_SCANNED + 2 {
            book(&d.path().join(format!("b{i}")), FULL);
        }
        let scan = scan_library(d.path()).unwrap();
        assert_eq!(scan.books.len(), MAX_SCANNED);
        assert!(scan.truncated);
    }

    #[test]
    fn a_scan_stops_at_the_folder_limit_and_says_so() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..=MAX_FOLDERS {
            std::fs::create_dir(d.path().join(format!("f{i}"))).unwrap();
        }
        let scan = scan_library(d.path()).unwrap();
        assert!(scan.truncated);
        assert!(scan.books.is_empty());
    }

    #[test]
    fn a_missing_or_file_root_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(matches!(scan_library(&d.path().join("gone")), Err(ProjectError::NotFound { .. })));
        fs::write(d.path().join("f"), "x").unwrap();
        assert!(matches!(scan_library(&d.path().join("f")), Err(ProjectError::NotAFile { .. })));
    }

    #[test]
    fn an_asset_stamp_changes_when_the_file_does_and_refuses_other_paths() {
        let d = tempfile::tempdir().unwrap();
        book(d.path(), FULL);
        fs::create_dir_all(d.path().join("assets/sub")).unwrap();
        fs::write(d.path().join("assets/c.png"), [1u8, 2, 3]).unwrap();
        let first = stat_asset(d.path(), "assets/c.png").unwrap();
        assert_eq!(first.size, 3);
        assert!(first.modified > 0);
        fs::write(d.path().join("assets/c.png"), [1u8, 2, 3, 4]).unwrap();
        assert_eq!(stat_asset(d.path(), "assets/c.png").unwrap().size, 4);
        assert!(matches!(stat_asset(d.path(), "cadabra.json"), Err(ProjectError::NotImageAsset { .. })));
        assert!(matches!(stat_asset(d.path(), "assets/a.txt"), Err(ProjectError::NotImageAsset { .. })));
        assert!(matches!(stat_asset(d.path(), "assets/gone.png"), Err(ProjectError::NotFound { .. })));
        fs::create_dir(d.path().join("assets/dir.png")).unwrap();
        assert!(matches!(stat_asset(d.path(), "assets/dir.png"), Err(ProjectError::NotAFile { .. })));
        assert!(stat_asset(d.path(), "assets/../cadabra.json").is_err());
    }

    #[test]
    fn an_oversized_asset_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let f = fs::File::create(d.path().join("big.png")).unwrap();
        f.set_len(super::super::MAX_IMAGE_BYTES + 1).unwrap();
        fs::create_dir_all(d.path().join("assets")).unwrap();
        fs::rename(d.path().join("big.png"), d.path().join("assets/big.png")).unwrap();
        assert!(matches!(stat_asset(d.path(), "assets/big.png"), Err(ProjectError::TooLarge { .. })));
    }
}

//! The native pickers and the paths they hand out. The webview never names a folder or file for `create_project`,
//! `import_asset`, `read_import_source`, `read_import_image`, `import_reference` or `fonts_import` on its own: those commands accept a path only when the author
//! picked it in a dialog opened here (see docs/architecture.md, "Pickers run in Rust").
use crate::platform::blocking;
#[cfg(not(test))]
use crate::platform::native_dialog::ask;
use crate::platform::native_dialog::Ask;
use crate::project::ProjectError;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Runtime, State};

/// What a picked path may be used for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickKind {
    /// A folder for a new book (also what "Open" picks; opening needs a real `cadabra.json` regardless).
    Folder,
    /// An image to copy into `assets/`.
    Image,
    /// A document to import (and the folder its Markdown images are read from).
    ImportSource,
    /// A file to copy into `references/` (picked in a dialog, or dropped on the window: see `record_drop`).
    Reference,
    /// A `.ttf` or `.otf` font to install.
    Font,
    /// A folder of books to scan for `cadabra.json` files (`scan_library`).
    Library,
}

/// Most picks remembered per kind; the oldest is forgotten first. An author makes a few picks per session, so this only
/// bounds what a webview that keeps calling a picker could make the app remember. References are picked (or dropped)
/// many at a time, so they get a longer list.
const fn max_per_kind(kind: PickKind) -> usize {
    match kind {
        PickKind::Reference => 512,
        _ => 32,
    }
}

/// Canonical paths the author chose, by kind. They stay valid for the session (not one-shot): a failed create or import is
/// retried without choosing again, and an import reads its source once and then its images.
#[derive(Clone, Default)]
pub struct PickedPaths(Arc<Mutex<VecDeque<(PickKind, PathBuf)>>>);

impl PickedPaths {
    /// Remembers `path` for `kind`. It must exist: it is stored in canonical form so a link or a different spelling of the
    /// same place cannot be used to name something else.
    pub fn record(&self, kind: PickKind, path: &Path) -> Result<(), ProjectError> {
        let canonical = path.canonicalize().map_err(|e| crate::project::io_error(e, &label(path)))?;
        let mut list = self.0.lock().unwrap_or_else(|e| e.into_inner());
        list.retain(|(k, p)| !(*k == kind && *p == canonical));
        list.push_back((kind, canonical));
        while list.iter().filter(|(k, _)| *k == kind).count() > max_per_kind(kind) {
            if let Some(i) = list.iter().position(|(k, _)| *k == kind) {
                list.remove(i);
            }
        }
        Ok(())
    }

    /// The canonical path when `path` is one the author picked for `kind`, otherwise `NotPicked`.
    pub fn require(&self, kind: PickKind, path: &Path) -> Result<PathBuf, ProjectError> {
        let refuse = || ProjectError::NotPicked { name: label(path) };
        let canonical = path.canonicalize().map_err(|_| refuse())?;
        let list = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if list.iter().any(|(k, p)| *k == kind && *p == canonical) {
            Ok(canonical)
        } else {
            Err(refuse())
        }
    }
}

/// A path's file name for messages (never the whole absolute path).
fn label(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "this path".to_string())
}

/// Records an answer from a dialog (None is a cancel) and returns the path as the author picked it, for the UI.
pub fn record_pick(picked: &PickedPaths, kind: PickKind, answer: Option<PathBuf>) -> Result<Option<String>, ProjectError> {
    let Some(path) = answer else { return Ok(None) };
    picked.record(kind, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// `create_project`: the folder must be one the author picked as a folder.
pub fn create_picked(picked: &PickedPaths, root: &str, manifest_json: &str) -> Result<(), ProjectError> {
    crate::project::create_project(&picked.require(PickKind::Folder, Path::new(root))?, manifest_json)
}

/// True when the file name ends in one of the image types `import_asset` accepts.
fn is_image_name(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| crate::project::IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Remembers files dropped on the window as picked references, and the first image among them as a picked image (the
/// editor imports one picture per drop). Folders and anything that is not there are skipped; a drop is the author's own
/// choice, delivered by the operating system, so it is as good as a pick in a dialog.
pub fn record_drop(picked: &PickedPaths, paths: &[PathBuf]) {
    let files: Vec<&PathBuf> = paths.iter().filter(|p| p.is_file()).collect();
    for p in &files {
        let _ = picked.record(PickKind::Reference, p);
    }
    if let Some(image) = files.iter().find(|p| is_image_name(p)) {
        let _ = picked.record(PickKind::Image, image);
    }
}

/// What opens a dialog. The real one in the app; tests swap in a queue of canned answers (`fake_dialog`), because the
/// OS dialog needs a window and a person.
type Asker<R> = fn(&AppHandle<R>, Ask) -> Vec<PathBuf>;

#[cfg(not(test))]
fn asker<R: Runtime>() -> Asker<R> {
    ask::<R>
}

#[cfg(test)]
fn asker<R: Runtime>() -> Asker<R> {
    fake_dialog::ask::<R>
}

/// The answer to one dialog: a queued dev-automation answer when there is one (debug builds with the feature only),
/// otherwise the dialog on the blocking pool.
async fn answer<R: Runtime>(app: AppHandle<R>, what: Ask) -> Result<Vec<PathBuf>, ProjectError> {
    #[cfg(all(feature = "dev-automation", debug_assertions))]
    if let Some(queued) = crate::automation::take_queued(&app) {
        return Ok(queued.map(PathBuf::from).into_iter().collect());
    }
    answer_with(app, what, asker::<R>()).await
}

async fn answer_with<R: Runtime>(app: AppHandle<R>, what: Ask, asker: Asker<R>) -> Result<Vec<PathBuf>, ProjectError> {
    blocking(move || Ok::<_, ProjectError>(asker(&app, what))).await
}

/// Native folder picker; returns the folder's absolute path (or null on cancel) and remembers it for `create_project`.
#[tauri::command]
pub async fn pick_folder<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::Folder, answer(app, Ask::Folder).await?.into_iter().next())
}

/// Native picker for one image; remembered for `import_asset`.
#[tauri::command]
pub async fn pick_image<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::Image, answer(app, Ask::Image).await?.into_iter().next())
}

/// Native picker for a document to import; remembered for `read_import_source` and `read_import_image`.
#[tauri::command]
pub async fn pick_import_source<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::ImportSource, answer(app, Ask::ImportSource).await?.into_iter().next())
}

/// Native picker for reference files (any type, several at once); remembered for `import_reference`. Empty on cancel.
#[tauri::command]
pub async fn pick_reference_files<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Vec<String>, ProjectError> {
    record_picks(&picked, PickKind::Reference, answer(app, Ask::References).await?)
}

/// Native picker for one `.ttf` or `.otf` font; remembered for `fonts_import`.
#[tauri::command]
pub async fn pick_font_file<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::Font, answer(app, Ask::Font).await?.into_iter().next())
}

/// Native folder picker for a folder of books; remembered for `scan_library`.
#[tauri::command]
pub async fn pick_library_folder<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::Library, answer(app, Ask::Library).await?.into_iter().next())
}

/// Records several answers of one dialog (a cancel is an empty list); returns the paths as the author picked them.
pub fn record_picks(picked: &PickedPaths, kind: PickKind, answers: Vec<PathBuf>) -> Result<Vec<String>, ProjectError> {
    answers.into_iter().filter_map(|p| record_pick(picked, kind, Some(p)).transpose()).collect()
}

/// Canned dialog answers for the IPC tests (the OS dialog needs a window and a person), with what each dialog was asked
/// for. One test uses them, so there is nothing to interleave.
#[cfg(test)]
pub(crate) mod fake_dialog {
    use super::*;

    pub(crate) static ANSWERS: Mutex<VecDeque<Option<PathBuf>>> = Mutex::new(VecDeque::new());
    /// Answers of the multi-select dialog (references); an empty list is a cancel.
    pub(crate) static ANSWERS_MANY: Mutex<VecDeque<Vec<PathBuf>>> = Mutex::new(VecDeque::new());
    pub(crate) static ASKED: Mutex<Vec<String>> = Mutex::new(Vec::new());

    pub(super) fn ask<R: Runtime>(_: &AppHandle<R>, what: Ask) -> Vec<PathBuf> {
        ASKED.lock().unwrap().push(format!("{what:?}"));
        if what == Ask::References {
            return ANSWERS_MANY.lock().unwrap().pop_front().expect("a queued answer");
        }
        ANSWERS.lock().unwrap().pop_front().expect("a queued answer").into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_recorded_path_of_the_same_kind_is_accepted() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        let file = dir.path().join("a.png");
        std::fs::write(&file, "x").unwrap();
        assert!(matches!(picked.require(PickKind::Image, &file), Err(ProjectError::NotPicked { name }) if name == "a.png"));
        assert_eq!(record_pick(&picked, PickKind::Image, Some(file.clone())).unwrap(), Some(file.to_string_lossy().into_owned()));
        assert_eq!(picked.require(PickKind::Image, &file).unwrap(), file.canonicalize().unwrap());
        assert!(picked.require(PickKind::Folder, &file).is_err() && picked.require(PickKind::ImportSource, &file).is_err());
    }

    #[test]
    fn several_picks_are_recorded_for_their_kind_and_a_missing_one_fails_the_whole_answer() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        let (a, b) = (dir.path().join("a.pdf"), dir.path().join("b.txt"));
        std::fs::write(&a, "x").unwrap();
        std::fs::write(&b, "x").unwrap();
        let shown = record_picks(&picked, PickKind::Reference, vec![a.clone(), b.clone()]).unwrap();
        assert_eq!(shown, [a.to_string_lossy(), b.to_string_lossy()]);
        assert!(picked.require(PickKind::Reference, &a).is_ok() && picked.require(PickKind::Reference, &b).is_ok());
        assert!(picked.require(PickKind::Font, &a).is_err() && picked.require(PickKind::Image, &a).is_err(), "a reference is not a font or an image");
        assert!(record_picks(&picked, PickKind::Reference, vec![]).unwrap().is_empty(), "a cancel");
        assert!(record_picks(&picked, PickKind::Reference, vec![dir.path().join("gone.pdf")]).is_err());
    }

    #[test]
    fn dropped_files_are_remembered_as_references_but_folders_and_missing_paths_are_not() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        let (file, folder) = (dir.path().join("a.pdf"), dir.path().join("sub"));
        std::fs::write(&file, "x").unwrap();
        std::fs::create_dir(&folder).unwrap();
        record_drop(&picked, &[file.clone(), folder.clone(), dir.path().join("gone.pdf")]);
        assert!(picked.require(PickKind::Reference, &file).is_ok());
        assert!(picked.require(PickKind::Reference, &folder).is_err());
        assert!(picked.require(PickKind::Image, &file).is_err(), "a drop of a PDF is not an image");
    }

    #[test]
    fn the_first_dropped_image_is_also_remembered_as_an_image() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        let (first, second, doc) = (dir.path().join("a.PNG"), dir.path().join("b.jpg"), dir.path().join("c.txt"));
        for f in [&first, &second, &doc] {
            std::fs::write(f, "x").unwrap();
        }
        record_drop(&picked, &[doc.clone(), first.clone(), second.clone()]);
        assert!(picked.require(PickKind::Image, &first).is_ok(), "an upper-case extension counts");
        assert!(picked.require(PickKind::Image, &second).is_err(), "one picture per drop");
        assert!(picked.require(PickKind::Image, &doc).is_err());
        assert!(picked.require(PickKind::Reference, &first).is_ok(), "it is still a reference candidate");
        let folder = dir.path().join("pics.png");
        std::fs::create_dir(&folder).unwrap();
        record_drop(&picked, std::slice::from_ref(&folder));
        assert!(picked.require(PickKind::Image, &folder).is_err(), "a folder named like an image is not one");
        let noext = dir.path().join("noext");
        std::fs::write(&noext, "x").unwrap();
        record_drop(&picked, std::slice::from_ref(&noext));
        assert!(picked.require(PickKind::Image, &noext).is_err());
    }

    #[test]
    fn references_keep_a_longer_list_than_the_other_kinds() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        let files: Vec<PathBuf> = (0..max_per_kind(PickKind::Folder) + 8).map(|i| dir.path().join(format!("f{i}.txt"))).collect();
        for f in &files {
            std::fs::write(f, "x").unwrap();
        }
        record_picks(&picked, PickKind::Reference, files.clone()).unwrap();
        assert!(files.iter().all(|f| picked.require(PickKind::Reference, f).is_ok()), "a drop of 40 files keeps all of them");
        assert!(max_per_kind(PickKind::Reference) > max_per_kind(PickKind::Font));
    }

    #[test]
    fn a_cancel_records_nothing_and_a_missing_path_is_refused() {
        let picked = PickedPaths::default();
        assert_eq!(record_pick(&picked, PickKind::Folder, None).unwrap(), None);
        assert!(matches!(record_pick(&picked, PickKind::Folder, Some(PathBuf::from("/no/such/folder"))), Err(ProjectError::NotFound { .. })));
        assert!(picked.require(PickKind::Folder, Path::new("/no/such/folder")).is_err());
        assert_eq!(label(Path::new("/")), "this path");
    }

    #[test]
    fn another_spelling_of_a_picked_path_is_the_same_path_but_a_child_is_not() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        std::fs::create_dir_all(dir.path().join("a/b")).unwrap();
        std::fs::create_dir_all(dir.path().join("c")).unwrap();
        picked.record(PickKind::Folder, &dir.path().join("a")).unwrap();
        assert!(picked.require(PickKind::Folder, &dir.path().join("a/b/..")).is_ok());
        assert!(picked.require(PickKind::Folder, &dir.path().join("a/b")).is_err(), "a child of a picked folder was not picked");
        assert!(picked.require(PickKind::Folder, &dir.path().join("c")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_picked_path_resolves_to_it_and_a_link_to_another_does_not() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        std::fs::write(dir.path().join("ok.md"), "x").unwrap();
        std::fs::write(dir.path().join("other.md"), "x").unwrap();
        std::os::unix::fs::symlink(dir.path().join("ok.md"), dir.path().join("link.md")).unwrap();
        picked.record(PickKind::ImportSource, &dir.path().join("ok.md")).unwrap();
        assert!(picked.require(PickKind::ImportSource, &dir.path().join("link.md")).is_ok());
        std::os::unix::fs::symlink(dir.path().join("other.md"), dir.path().join("evil.md")).unwrap();
        assert!(picked.require(PickKind::ImportSource, &dir.path().join("evil.md")).is_err());
    }

    #[test]
    fn a_poisoned_lock_does_not_lose_the_picks() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        picked.record(PickKind::Folder, dir.path()).unwrap();
        let held = picked.clone();
        assert!(std::thread::spawn(move || {
            let _guard = held.0.lock().unwrap();
            panic!("poison the lock");
        })
        .join()
        .is_err());
        assert!(picked.require(PickKind::Folder, dir.path()).is_ok());
        assert!(picked.record(PickKind::Folder, dir.path()).is_ok());
    }

    #[test]
    fn the_list_is_bounded_per_kind_and_forgets_the_oldest_first() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        let names: Vec<PathBuf> = (0..max_per_kind(PickKind::Folder) + 3).map(|i| dir.path().join(format!("{i}"))).collect();
        for n in &names {
            std::fs::create_dir(n).unwrap();
            picked.record(PickKind::Folder, n).unwrap();
        }
        let image = dir.path().join("pic.png");
        std::fs::write(&image, "x").unwrap();
        picked.record(PickKind::Image, &image).unwrap();
        assert!(picked.require(PickKind::Folder, &names[0]).is_err() && picked.require(PickKind::Folder, &names[2]).is_err());
        assert!(picked.require(PickKind::Folder, &names[3]).is_ok() && picked.require(PickKind::Folder, names.last().unwrap()).is_ok());
        assert!(picked.require(PickKind::Image, &image).is_ok(), "another kind is not evicted");
        picked.record(PickKind::Folder, &names[3]).unwrap(); // picking again refreshes, it does not duplicate
        assert_eq!(picked.0.lock().unwrap().iter().filter(|(k, _)| *k == PickKind::Folder).count(), max_per_kind(PickKind::Folder));
    }
}

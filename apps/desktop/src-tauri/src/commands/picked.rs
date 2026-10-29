//! The native pickers and the paths they hand out. The webview never names a folder or file for `create_project`,
//! `import_asset`, `read_import_source` or `read_import_image` on its own: those commands accept a path only when the author
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
}

/// Most picks remembered per kind; the oldest is forgotten first. An author makes a few picks per session, so this only
/// bounds what a webview that keeps calling a picker could make the app remember.
const MAX_PER_KIND: usize = 32;

/// Canonical paths the author chose, by kind. They stay valid for the session (not one-shot): a failed create or import is
/// retried without choosing again, and an import reads its source once and then its images.
#[derive(Clone, Default)]
pub struct PickedPaths(Arc<Mutex<VecDeque<(PickKind, PathBuf)>>>);

impl PickedPaths {
    /// Remembers `path` for `kind`. It must exist: it is stored in canonical form so a link or a different spelling of the
    /// same place cannot be used to name something else.
    pub fn record(&self, kind: PickKind, path: &Path) -> Result<(), ProjectError> {
        let canonical = path.canonicalize().map_err(|e| crate::project::io_error(e, &label(path)))?;
        let mut list = self.0.lock().expect("picked paths lock");
        list.retain(|(k, p)| !(*k == kind && *p == canonical));
        list.push_back((kind, canonical));
        while list.iter().filter(|(k, _)| *k == kind).count() > MAX_PER_KIND {
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
        let list = self.0.lock().expect("picked paths lock");
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

/// What opens a dialog. The real one in the app; tests swap in a queue of canned answers (`fake_dialog`), because the
/// OS dialog needs a window and a person.
type Asker<R> = fn(&AppHandle<R>, Ask) -> Option<PathBuf>;

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
async fn answer<R: Runtime>(app: AppHandle<R>, what: Ask) -> Result<Option<PathBuf>, ProjectError> {
    #[cfg(all(feature = "dev-automation", debug_assertions))]
    if let Some(queued) = crate::automation::take_queued(&app) {
        return Ok(queued.map(PathBuf::from));
    }
    answer_with(app, what, asker::<R>()).await
}

async fn answer_with<R: Runtime>(app: AppHandle<R>, what: Ask, asker: Asker<R>) -> Result<Option<PathBuf>, ProjectError> {
    blocking(move || Ok::<_, ProjectError>(asker(&app, what))).await
}

/// Native folder picker; returns the folder's absolute path (or null on cancel) and remembers it for `create_project`.
#[tauri::command]
pub async fn pick_folder<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::Folder, answer(app, Ask::Folder).await?)
}

/// Native picker for one image; remembered for `import_asset`.
#[tauri::command]
pub async fn pick_image<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::Image, answer(app, Ask::Image).await?)
}

/// Native picker for a document to import; remembered for `read_import_source` and `read_import_image`.
#[tauri::command]
pub async fn pick_import_source<R: Runtime>(app: AppHandle<R>, picked: State<'_, PickedPaths>) -> Result<Option<String>, ProjectError> {
    record_pick(&picked, PickKind::ImportSource, answer(app, Ask::ImportSource).await?)
}

/// Canned dialog answers for the IPC tests (the OS dialog needs a window and a person), with what each dialog was asked
/// for. One test uses them, so there is nothing to interleave.
#[cfg(test)]
pub(crate) mod fake_dialog {
    use super::*;

    pub(crate) static ANSWERS: Mutex<VecDeque<Option<PathBuf>>> = Mutex::new(VecDeque::new());
    pub(crate) static ASKED: Mutex<Vec<String>> = Mutex::new(Vec::new());

    pub(super) fn ask<R: Runtime>(_: &AppHandle<R>, what: Ask) -> Option<PathBuf> {
        ASKED.lock().unwrap().push(format!("{what:?}"));
        ANSWERS.lock().unwrap().pop_front().expect("a queued answer")
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
    fn the_list_is_bounded_per_kind_and_forgets_the_oldest_first() {
        let (dir, picked) = (tempfile::tempdir().unwrap(), PickedPaths::default());
        let names: Vec<PathBuf> = (0..MAX_PER_KIND + 3).map(|i| dir.path().join(format!("{i}"))).collect();
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
        assert_eq!(picked.0.lock().unwrap().iter().filter(|(k, _)| *k == PickKind::Folder).count(), MAX_PER_KIND);
    }
}

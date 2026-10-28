//! Watches a project folder for changes made outside the app (cloud sync, another editor) and tells the UI.
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Default)]
pub struct WatchState(pub Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

/// Converts an absolute changed path to a project-relative path with "/" separators.
/// Returns None for paths outside the root and for app-internal folders that never need a reload.
pub fn relevant(root: &Path, changed: &Path) -> Option<String> {
    let rel = changed.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let first = parts.first()?;
    let name = parts.last()?;
    if first == ".cadabra" || first == "exports" || first == "references" || name.starts_with('.') && name.ends_with(".tmp") {
        return None;
    }
    Some(parts.join("/"))
}

pub fn start<R: Runtime>(app: AppHandle<R>, root: PathBuf, state: &WatchState) -> Result<(), String> {
    start_with(root, Duration::from_millis(400), Box::new(move |rel| drop(app.emit("project-changed", rel))), state)
}

/// `start` with the debounce and the notification sink injectable, so the watcher can be tested without an app.
fn start_with(root: PathBuf, debounce: Duration, mut notify: Box<dyn FnMut(String) + Send>, state: &WatchState) -> Result<(), String> {
    let r = root.clone();
    let mut debouncer = new_debouncer(debounce, move |res: notify_debouncer_mini::DebounceEventResult| {
        for e in res.into_iter().flatten() {
            if let Some(rel) = relevant(&r, &e.path) {
                notify(rel);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(debouncer); // replaces (and stops) any previous watcher
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_internal_and_foreign_paths() {
        let root = Path::new("/p");
        assert_eq!(relevant(root, Path::new("/p/manuscript/001-a.json")).as_deref(), Some("manuscript/001-a.json"));
        assert_eq!(relevant(root, Path::new("/p/manuscript/fr/001-a.json")).as_deref(), Some("manuscript/fr/001-a.json"));
        assert_eq!(relevant(root, Path::new("/p/cadabra.json")).as_deref(), Some("cadabra.json"));
        assert_eq!(relevant(root, Path::new("/p/.cadabra/trash/x")), None);
        assert_eq!(relevant(root, Path::new("/p/exports/book.epub")), None);
        assert_eq!(relevant(root, Path::new("/p/references/map.png")), None);
        assert_eq!(relevant(root, Path::new("/p/manuscript/.001-a.json.tmp")), None);
        assert_eq!(relevant(root, Path::new("/other/x.json")), None);
    }

    use std::fs;
    use std::sync::mpsc::{channel, Receiver, TryRecvError};

    const SHORT: Duration = Duration::from_millis(30);
    const HARD_TIMEOUT: Duration = Duration::from_secs(20);

    /// Waits (bounded) until `rx` delivers `wanted`; every path seen on the way is returned so tests can check filtering.
    fn wait_for(rx: &Receiver<String>, wanted: &str) -> Vec<String> {
        let mut seen = vec![];
        let found = std::iter::from_fn(|| rx.recv_timeout(HARD_TIMEOUT).ok()).any(|rel| {
            seen.push(rel.clone());
            rel == wanted
        });
        assert!(found, "no change event for {wanted}; saw {seen:?}");
        seen
    }

    #[test]
    fn reports_changes_under_the_root_and_skips_internal_folders_and_replaces_the_old_watcher() {
        let d = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(d.path()).unwrap(); // FSEvents reports real paths
        fs::create_dir_all(root.join("manuscript")).unwrap();
        fs::create_dir_all(root.join("exports")).unwrap();
        let state = WatchState::default();
        let (tx, rx) = channel();
        start_with(root.clone(), SHORT, Box::new(move |rel| drop(tx.send(rel))), &state).unwrap();
        fs::write(root.join("exports/book.epub"), "x").unwrap(); // ignored
        fs::write(root.join("manuscript/001-a.json"), "{}").unwrap();
        let seen = wait_for(&rx, "manuscript/001-a.json");
        assert!(seen.iter().all(|p| !p.starts_with("exports")), "{seen:?}");
        // A second start replaces (and stops) the first: the first sink's sender is dropped with it.
        let (tx2, rx2) = channel();
        start_with(root.clone(), SHORT, Box::new(move |rel| drop(tx2.send(rel))), &state).unwrap();
        while rx.recv_timeout(HARD_TIMEOUT).is_ok() {} // drain events already queued
        assert_eq!(rx.try_recv(), Err(TryRecvError::Disconnected), "the replaced watcher is gone");
        fs::write(root.join("manuscript/002-b.json"), "{}").unwrap();
        wait_for(&rx2, "manuscript/002-b.json");
    }

    #[test]
    fn a_missing_folder_or_a_poisoned_state_is_an_error_message() {
        let d = tempfile::tempdir().unwrap();
        let state = WatchState::default();
        let err = start_with(d.path().join("missing"), SHORT, Box::new(|_| {}), &state).unwrap_err();
        assert!(!err.is_empty());
        assert!(state.0.lock().unwrap().is_none());
        let poisoned = std::sync::Arc::new(WatchState::default());
        let p = poisoned.clone();
        let panicked = std::thread::spawn(move || {
            let _guard = p.0.lock().unwrap();
            panic!("poison the lock");
        })
        .join();
        assert!(panicked.is_err());
        let err = start_with(d.path().to_path_buf(), SHORT, Box::new(|_| {}), &poisoned).unwrap_err();
        assert!(err.contains("poison"), "{err}");
    }
}

//! Watches a project folder for changes made outside the app (cloud sync, another editor) and tells the UI.
use crate::project::ProjectError;
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

/// What the frontend hears when the watcher fails after it started (an overflowed event queue, a vanished folder).
pub const WATCH_ERROR_CODE: &str = "watch_failed";

pub fn start<R: Runtime>(app: AppHandle<R>, root: PathBuf, state: &WatchState) -> Result<(), ProjectError> {
    let errors = app.clone();
    start_with(
        root,
        Duration::from_millis(400),
        Box::new(move |rel| drop(app.emit("project-changed", rel))),
        Box::new(move || drop(errors.emit("project-watch-error", WATCH_ERROR_CODE))),
        state,
    )
}

/// Stops the running watcher, if any. Safe to call when nothing is watched.
pub fn stop(state: &WatchState) -> Result<(), ProjectError> {
    // Dropped outside the lock so a slow shutdown never blocks a following `start`.
    let old = state.0.lock().map_err(poisoned)?.take();
    drop(old);
    Ok(())
}

fn poisoned<T>(e: std::sync::PoisonError<T>) -> ProjectError {
    ProjectError::Io { message: e.to_string() }
}

/// Routes one debouncer delivery: relevant changed paths go to `notify`, a watcher error goes to `on_error` (once per delivery).
fn deliver(root: &Path, res: notify_debouncer_mini::DebounceEventResult, notify: &mut (dyn FnMut(String) + Send), on_error: &mut (dyn FnMut() + Send)) {
    match res {
        Ok(events) => events.iter().filter_map(|e| relevant(root, &e.path)).for_each(notify),
        Err(_) => on_error(),
    }
}

/// `start` with the debounce and the sinks injectable, so the watcher can be tested without an app.
fn start_with(
    root: PathBuf,
    debounce: Duration,
    mut notify: Box<dyn FnMut(String) + Send>,
    mut on_error: Box<dyn FnMut() + Send>,
    state: &WatchState,
) -> Result<(), ProjectError> {
    // FSEvents reports real paths: a root given through a link (macOS /var, a linked sync folder) would match nothing.
    let root = std::fs::canonicalize(&root).unwrap_or(root);
    // Only the folder name goes into the error: the UI never shows absolute paths.
    let failed = || ProjectError::WatchFailed { path: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() };
    let r = root.clone();
    let mut debouncer =
        new_debouncer(debounce, move |res: notify_debouncer_mini::DebounceEventResult| deliver(&r, res, &mut *notify, &mut *on_error)).map_err(|_| failed())?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive).map_err(|_| failed())?;
    let old = state.0.lock().map_err(poisoned)?.replace(debouncer); // replaces any previous watcher
    drop(old); // stopped outside the lock
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

    // Sinks for tests that do not look at one of the two. Named functions, not closures: a closure that is never called is an
    // uncovered function. `the_unused_sinks_do_nothing` calls them.
    fn forward(tx: std::sync::mpsc::Sender<String>) -> Box<dyn FnMut(String) + Send> {
        Box::new(move |rel| drop(tx.send(rel)))
    }
    fn no_error() {}
    fn no_change(_: String) {}

    #[test]
    fn the_unused_sinks_do_nothing() {
        no_error();
        no_change("manuscript/a.json".into());
    }

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
        start_with(root.clone(), SHORT, forward(tx), Box::new(no_error), &state).unwrap();
        fs::write(root.join("exports/book.epub"), "x").unwrap(); // ignored
        fs::write(root.join("manuscript/001-a.json"), "{}").unwrap();
        let seen = wait_for(&rx, "manuscript/001-a.json");
        assert!(seen.iter().all(|p| !p.starts_with("exports")), "{seen:?}");
        // A second start replaces (and stops) the first: the first sink's sender is dropped with it.
        let (tx2, rx2) = channel();
        start_with(root.clone(), SHORT, forward(tx2), Box::new(no_error), &state).unwrap();
        while rx.recv_timeout(HARD_TIMEOUT).is_ok() {} // drain events already queued
        assert_eq!(rx.try_recv(), Err(TryRecvError::Disconnected), "the replaced watcher is gone");
        fs::write(root.join("manuscript/002-b.json"), "{}").unwrap();
        wait_for(&rx2, "manuscript/002-b.json");
    }

    #[cfg(unix)]
    #[test]
    fn a_root_given_through_a_link_still_reports_changes() {
        let d = tempfile::tempdir().unwrap();
        let real = fs::canonicalize(d.path()).unwrap();
        fs::create_dir_all(real.join("book/manuscript")).unwrap();
        std::os::unix::fs::symlink(real.join("book"), real.join("linked")).unwrap();
        let state = WatchState::default();
        let (tx, rx) = channel();
        start_with(real.join("linked"), SHORT, forward(tx), Box::new(no_error), &state).unwrap();
        fs::write(real.join("book/manuscript/001-a.json"), "{}").unwrap();
        wait_for(&rx, "manuscript/001-a.json");
    }

    #[test]
    fn a_missing_folder_or_a_poisoned_state_is_a_typed_error() {
        let d = tempfile::tempdir().unwrap();
        let state = WatchState::default();
        let err = start_with(d.path().join("missing"), SHORT, Box::new(no_change), Box::new(no_error), &state).unwrap_err();
        assert_eq!(err, ProjectError::WatchFailed { path: "missing".into() });
        assert!(state.0.lock().unwrap().is_none());
        let poisoned = std::sync::Arc::new(WatchState::default());
        let p = poisoned.clone();
        let panicked = std::thread::spawn(move || {
            let _guard = p.0.lock().unwrap();
            panic!("poison the lock");
        })
        .join();
        assert!(panicked.is_err());
        let err = start_with(d.path().to_path_buf(), SHORT, Box::new(no_change), Box::new(no_error), &poisoned).unwrap_err();
        assert!(matches!(&err, ProjectError::Io { message } if message.contains("poison")), "{err:?}");
        assert!(matches!(stop(&poisoned), Err(ProjectError::Io { .. })));
    }

    #[test]
    fn a_watcher_error_is_reported_and_changes_still_flow() {
        let root = Path::new("/p");
        let (mut changed, mut errors) = (vec![], 0);
        let event = |path: &str| notify_debouncer_mini::DebouncedEvent::new(PathBuf::from(path), notify_debouncer_mini::DebouncedEventKind::Any);
        let mut on_change = |rel: String| changed.push(rel);
        let mut on_error = || errors += 1;
        deliver(root, Ok(vec![event("/p/manuscript/a.json"), event("/p/exports/x.epub")]), &mut on_change, &mut on_error);
        deliver(root, Err(notify_debouncer_mini::notify::Error::generic("overflow")), &mut on_change, &mut on_error);
        assert_eq!((changed.as_slice(), errors), (&["manuscript/a.json".to_string()][..], 1));
    }

    #[test]
    fn stop_ends_the_watcher_and_is_safe_to_repeat() {
        let d = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(d.path()).unwrap();
        let state = WatchState::default();
        stop(&state).unwrap(); // nothing watched
        let (tx, rx) = channel::<String>();
        start_with(root.clone(), SHORT, forward(tx), Box::new(no_error), &state).unwrap();
        assert!(state.0.lock().unwrap().is_some());
        stop(&state).unwrap();
        assert!(state.0.lock().unwrap().is_none());
        while rx.recv_timeout(HARD_TIMEOUT).is_ok() {}
        assert_eq!(rx.try_recv(), Err(TryRecvError::Disconnected), "the stopped watcher is gone");
        stop(&state).unwrap();
    }
}

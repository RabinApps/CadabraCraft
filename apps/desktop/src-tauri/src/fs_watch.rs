//! Watches a project folder for changes made outside the app (cloud sync, another editor) and tells the UI.
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct WatchState(pub Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

/// Converts an absolute changed path to a project-relative path with "/" separators.
/// Returns None for paths outside the root and for app-internal folders that never need a reload.
pub fn relevant(root: &Path, changed: &Path) -> Option<String> {
    let rel = changed.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let first = parts.first()?;
    let name = parts.last()?;
    if first == ".cadabra" || first == "exports" || name.starts_with('.') && name.ends_with(".tmp") {
        return None;
    }
    Some(parts.join("/"))
}

pub fn start(app: AppHandle, root: PathBuf, state: &WatchState) -> Result<(), String> {
    let r = root.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(400), move |res: notify_debouncer_mini::DebounceEventResult| {
        if let Ok(events) = res {
            for e in events {
                if let Some(rel) = relevant(&r, &e.path) {
                    let _ = app.emit("project-changed", rel);
                }
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
        assert_eq!(relevant(root, Path::new("/p/cadabra.json")).as_deref(), Some("cadabra.json"));
        assert_eq!(relevant(root, Path::new("/p/.cadabra/trash/x")), None);
        assert_eq!(relevant(root, Path::new("/p/exports/book.epub")), None);
        assert_eq!(relevant(root, Path::new("/p/manuscript/.001-a.json.tmp")), None);
        assert_eq!(relevant(root, Path::new("/other/x.json")), None);
    }
}

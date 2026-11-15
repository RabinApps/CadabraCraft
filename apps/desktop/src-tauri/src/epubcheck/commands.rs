//! The Tauri command layer for EPUB validation (blocking work runs off the UI thread).
use super::engine::{find_runtime, validate, Runtime, VALIDATE_TIMEOUT};
use super::error::EpubcheckError;
use super::report::Report;
use crate::platform::blocking;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// The cancel flag of the check in progress. There is one check at a time (the Export dialog is modal).
#[derive(Default)]
pub struct EpubcheckJob(Arc<AtomicBool>);

#[cfg(test)]
impl EpubcheckJob {
    /// Whether a cancel is pending (tests of the command layer read it).
    pub(crate) fn cancel_requested(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct EpubcheckInfo {
    /// True when the Java runtime is the one bundled with the app (always so in a release build).
    pub bundled: bool,
}

type Finder = Box<dyn FnOnce() -> Result<Runtime, EpubcheckError> + Send + 'static>;

/// Whether EPUBCheck can run here, without starting it.
#[tauri::command]
pub async fn epubcheck_find() -> Result<EpubcheckInfo, EpubcheckError> {
    blocking(move || find_runtime().map(|rt| EpubcheckInfo { bundled: rt.bundled })).await
}

/// The body of `epubcheck_validate`: the EPUB must be a file inside the book folder (the same path rules as every project command).
async fn validate_job(root: String, path: String, flag: Arc<AtomicBool>, find: Finder, timeout: Duration) -> Result<Report, EpubcheckError> {
    flag.store(false, Ordering::Relaxed);
    blocking(move || {
        let root = crate::project::require_project(&PathBuf::from(root))?;
        let epub = crate::project::resolve(&root, &path)?;
        if !epub.symlink_metadata().map(|m| m.is_file()).unwrap_or(false) {
            return Err(EpubcheckError::NoEpub);
        }
        validate(&find()?, &epub, timeout, &flag)
    })
    .await
}

/// Validates the exported EPUB at `path` (relative to the book folder, for example `exports/en/book.epub`). Stop it with `epubcheck_cancel`.
#[tauri::command]
pub async fn epubcheck_validate(state: tauri::State<'_, EpubcheckJob>, root: String, path: String) -> Result<Report, EpubcheckError> {
    validate_job(root, path, state.0.clone(), Box::new(find_runtime), VALIDATE_TIMEOUT).await
}

#[tauri::command]
pub fn epubcheck_cancel(state: tauri::State<'_, EpubcheckJob>) {
    state.0.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn missing() -> Finder {
        Box::new(|| Err(EpubcheckError::NotFound { message: "none".into() }))
    }

    #[cfg(unix)]
    #[test]
    fn epubcheck_find_reports_a_runtime_from_the_environment_as_not_bundled() {
        use std::os::unix::fs::PermissionsExt;
        if !cfg!(debug_assertions) {
            return; // release builds ignore the environment on purpose
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("epubcheck.jar"), "x").unwrap();
        let java = dir.path().join("java");
        std::fs::write(&java, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&java, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("EPUBCHECK_DIR", dir.path());
        std::env::set_var("JAVA_BIN", &java);
        let info = tauri::async_runtime::block_on(epubcheck_find());
        std::env::remove_var("EPUBCHECK_DIR");
        std::env::remove_var("JAVA_BIN");
        assert_eq!(info, Ok(EpubcheckInfo { bundled: false }));
    }

    #[test]
    fn a_path_outside_the_book_is_refused_before_anything_runs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let flag = Arc::new(AtomicBool::new(false));
        let run = |p: &str| tauri::async_runtime::block_on(validate_job(root.clone(), p.into(), flag.clone(), missing(), Duration::from_secs(1)));
        assert!(matches!(run("../secret.epub"), Err(EpubcheckError::Other { .. })));
        assert!(matches!(run("/etc/passwd"), Err(EpubcheckError::Other { .. })));
        assert_eq!(run("exports/en/book.epub"), Err(EpubcheckError::NoEpub));
    }

    #[test]
    fn an_existing_epub_reaches_the_finder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("cadabra.json"), "{}").unwrap();
        std::fs::write(dir.path().join("book.epub"), "x").unwrap();
        let flag = Arc::new(AtomicBool::new(true));
        let r = tauri::async_runtime::block_on(validate_job(
            dir.path().to_string_lossy().into_owned(),
            "book.epub".into(),
            flag.clone(),
            missing(),
            Duration::from_secs(1),
        ));
        assert!(matches!(r, Err(EpubcheckError::NotFound { .. })));
        assert!(!flag.load(Ordering::Relaxed), "a new check starts with the cancel flag cleared");
    }

    #[test]
    fn a_not_a_book_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let flag = Arc::new(AtomicBool::new(false));
        let r = tauri::async_runtime::block_on(validate_job(
            dir.path().to_string_lossy().into_owned(),
            "book.epub".into(),
            flag,
            missing(),
            Duration::from_secs(1),
        ));
        assert!(matches!(r, Err(EpubcheckError::Other { .. })));
    }
}

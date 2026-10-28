//! Job cancel flags and the voices folder.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

static VOICES_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Where voices live (set once at startup to the app data folder). `CADABRA_VOICES_DIR` overrides it for development.
pub fn set_voices_dir(dir: PathBuf) {
    let _ = VOICES_DIR.set(dir);
}

pub(crate) fn voices_root() -> Option<PathBuf> {
    std::env::var_os("CADABRA_VOICES_DIR").map(PathBuf::from).or_else(|| VOICES_DIR.get().cloned())
}

/// Cancel flags by job id. A flag is created by whichever of render or cancel comes first, so a Cancel that arrives
/// between two chapters still stops the next one.
#[derive(Default)]
pub struct AudioJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl AudioJobs {
    pub(crate) fn flag(&self, id: &str) -> Arc<AtomicBool> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).entry(id.to_string()).or_default().clone()
    }

    pub fn cancel(&self, id: &str) {
        self.flag(id).store(true, Ordering::Relaxed);
    }

    pub fn forget(&self, id: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jobs_cancel_before_or_after_a_render_starts() {
        let jobs = AudioJobs::default();
        jobs.cancel("a");
        assert!(jobs.flag("a").load(Ordering::Relaxed));
        let b = jobs.flag("b");
        assert!(!b.load(Ordering::Relaxed));
        jobs.cancel("b");
        assert!(b.load(Ordering::Relaxed));
        jobs.forget("a");
        assert!(!jobs.flag("a").load(Ordering::Relaxed));
    }

    #[test]
    fn a_poisoned_lock_does_not_lose_the_flags() {
        let jobs = std::sync::Arc::new(AudioJobs::default());
        jobs.cancel("a");
        let held = jobs.clone();
        assert!(std::thread::spawn(move || {
            let _guard = held.0.lock().unwrap();
            panic!("poison the lock");
        })
        .join()
        .is_err());
        assert!(jobs.flag("a").load(Ordering::Relaxed));
        jobs.forget("a");
        assert!(!jobs.flag("a").load(Ordering::Relaxed));
    }

    #[test]
    fn the_voices_folder_is_set_once_and_the_development_override_wins() {
        let first = std::env::temp_dir().join("cadabracraft-test-voices");
        set_voices_dir(first.clone());
        set_voices_dir(std::env::temp_dir().join("cadabracraft-other-voices")); // the first one stays
        assert_eq!(VOICES_DIR.get(), Some(&first));
        let expected = std::env::var_os("CADABRA_VOICES_DIR").map(PathBuf::from).unwrap_or(first);
        assert_eq!(voices_root(), Some(expected));
    }
}

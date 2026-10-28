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
}

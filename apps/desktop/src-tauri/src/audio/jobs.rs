//! Job cancel flags and the voices folder.
use std::collections::{HashMap, HashSet};
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
pub struct AudioJobs(Mutex<HashMap<String, Arc<AtomicBool>>>, Mutex<HashSet<String>>);

impl AudioJobs {
    pub(crate) fn flag(&self, id: &str) -> Arc<AtomicBool> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).entry(id.to_string()).or_default().clone()
    }

    pub fn cancel(&self, id: &str) {
        self.flag(id).store(true, Ordering::Relaxed);
    }

    /// Marks a pack as downloading, or None when it already is (two downloads of one pack would write the same `.part`
    /// files). The mark is removed when the returned guard drops, on every path.
    pub(crate) fn begin_download(&self, pack: &str) -> Option<DownloadGuard<'_>> {
        self.1.lock().unwrap_or_else(|e| e.into_inner()).insert(pack.to_string()).then(|| DownloadGuard { jobs: self, pack: pack.to_string() })
    }

    pub fn forget(&self, id: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    }
}

pub(crate) struct DownloadGuard<'a> {
    jobs: &'a AudioJobs,
    pack: String,
}

impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.jobs.1.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.pack);
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
    fn a_pack_downloads_once_at_a_time() {
        let jobs = AudioJobs::default();
        let first = jobs.begin_download("p").expect("first download starts");
        assert!(jobs.begin_download("p").is_none());
        assert!(jobs.begin_download("q").is_some(), "other packs are independent");
        drop(first);
        assert!(jobs.begin_download("p").is_some(), "the mark is released when the download ends");
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

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

/// Most cancel flags kept at once; far more than the jobs one author runs together.
const MAX_FLAGS: usize = 256;

/// Cancel flags by job id. A flag is created by whichever of render or cancel comes first, so a Cancel that arrives
/// between two chapters still stops the next one.
#[derive(Default)]
pub struct AudioJobs(Mutex<HashMap<String, Arc<AtomicBool>>>, Mutex<HashSet<String>>);

impl AudioJobs {
    /// The flag of job `id`. The table holds at most `MAX_FLAGS` entries, because the ids come from the webview: when it is
    /// full, flags nobody is using any more (their job ended, or a cancel arrived for a job that never started) are
    /// dropped first. If every flag is in use, the caller gets a flag that is not stored (it works, but `cancel` cannot find it).
    pub(crate) fn flag(&self, id: &str) -> Arc<AtomicBool> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = map.get(id) {
            return f.clone();
        }
        if map.len() >= MAX_FLAGS {
            map.retain(|_, f| Arc::strong_count(f) > 1);
        }
        let flag = Arc::new(AtomicBool::new(false));
        if map.len() < MAX_FLAGS {
            map.insert(id.to_string(), flag.clone());
        }
        flag
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
    fn the_flag_table_is_bounded_and_drops_idle_flags_first() {
        let jobs = AudioJobs::default();
        let running = jobs.flag("running"); // held by a job, so it must survive
        for i in 0..MAX_FLAGS * 2 {
            jobs.cancel(&format!("spam-{i}"));
        }
        assert!(jobs.0.lock().unwrap().len() <= MAX_FLAGS);
        jobs.cancel("running");
        assert!(running.load(Ordering::Relaxed), "a flag in use is never evicted");
        assert!(jobs.flag("running").load(Ordering::Relaxed));
    }

    #[test]
    fn when_every_flag_is_in_use_a_new_job_still_gets_a_working_unstored_flag() {
        let jobs = AudioJobs::default();
        let held: Vec<_> = (0..MAX_FLAGS).map(|i| jobs.flag(&format!("job-{i}"))).collect();
        let extra = jobs.flag("one-more");
        assert!(!extra.load(Ordering::Relaxed));
        assert_eq!(jobs.0.lock().unwrap().len(), MAX_FLAGS);
        jobs.cancel("one-more"); // finds nothing stored: only a new, unrelated flag is set
        assert!(!extra.load(Ordering::Relaxed));
        drop(held);
        assert!(!jobs.flag("job-0").load(Ordering::Relaxed));
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
    fn a_poisoned_download_lock_still_marks_and_releases_packs() {
        let jobs = std::sync::Arc::new(AudioJobs::default());
        let held = jobs.clone();
        assert!(std::thread::spawn(move || {
            let _guard = held.1.lock().unwrap();
            panic!("poison the lock");
        })
        .join()
        .is_err());
        let guard = jobs.begin_download("p").expect("a poisoned lock does not stop downloads");
        assert!(jobs.begin_download("p").is_none());
        drop(guard);
        assert!(jobs.begin_download("p").is_some());
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

#[cfg(test)]
mod review_repro;

//! Job cancel flags and the voices folder.
use std::collections::{HashMap, HashSet, VecDeque};
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

/// Most idle cancel flags kept at once; far more than the jobs one author runs together.
const MAX_FLAGS: usize = 256;

/// Most cancels remembered for jobs that have not started yet.
const MAX_EARLY_CANCELS: usize = 64;

/// Cancel flags by job id. A flag is created by whichever of render or cancel comes first, so a Cancel that arrives
/// between two chapters still stops the next one. The third field holds ids cancelled before any flag existed.
#[derive(Default)]
pub struct AudioJobs(Mutex<HashMap<String, Arc<AtomicBool>>>, Mutex<HashSet<String>>, Mutex<VecDeque<String>>);

impl AudioJobs {
    /// The flag of job `id`. The ids come from the webview, so memory stays bounded: once the table holds `MAX_FLAGS`
    /// entries, flags nobody is using any more (their job ended) are dropped before a new one is added. Flags that a
    /// running job holds are always kept (and so always reachable by `cancel`), so the table can only exceed
    /// `MAX_FLAGS` by the number of jobs actually running. A flag whose id was cancelled before it existed starts set.
    pub(crate) fn flag(&self, id: &str) -> Arc<AtomicBool> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = map.get(id) {
            return f.clone();
        }
        if map.len() >= MAX_FLAGS {
            map.retain(|_, f| Arc::strong_count(f) > 1);
        }
        let early = self.take_early_cancel(id);
        let flag = Arc::new(AtomicBool::new(early));
        map.insert(id.to_string(), flag.clone());
        flag
    }

    fn take_early_cancel(&self, id: &str) -> bool {
        let mut early = self.2.lock().unwrap_or_else(|e| e.into_inner());
        early.iter().position(|e| e == id).is_some_and(|i| early.remove(i).is_some())
    }

    /// Cancels job `id`, whether or not it has started. A cancel for a job without a flag is also remembered in a small
    /// bounded list (oldest dropped first), so sweeping the idle entry cannot lose it.
    pub fn cancel(&self, id: &str) {
        // The table lock is held while the mark is stored, so a `flag(id)` cannot slip in between and miss it.
        let map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(f) = map.get(id) {
            f.store(true, Ordering::Relaxed);
            return;
        }
        let mut early = self.2.lock().unwrap_or_else(|e| e.into_inner());
        if !early.iter().any(|e| e == id) {
            if early.len() >= MAX_EARLY_CANCELS {
                early.pop_front();
            }
            early.push_back(id.to_string());
        }
    }

    /// Marks a pack as downloading, or None when it already is (two downloads of one pack would write the same `.part`
    /// files). The mark is removed when the returned guard drops, on every path.
    pub(crate) fn begin_download(&self, pack: &str) -> Option<DownloadGuard<'_>> {
        self.1.lock().unwrap_or_else(|e| e.into_inner()).insert(pack.to_string()).then(|| DownloadGuard { jobs: self, pack: pack.to_string() })
    }

    pub fn forget(&self, id: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        self.take_early_cancel(id);
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
    fn cancel_reaches_a_job_even_when_every_flag_is_held() {
        let jobs = AudioJobs::default();
        let _held: Vec<_> = (0..MAX_FLAGS).map(|i| jobs.flag(&format!("job-{i}"))).collect();
        let mine = jobs.flag("mine");
        assert!(!mine.load(Ordering::Relaxed));
        jobs.cancel("mine");
        assert!(mine.load(Ordering::Relaxed), "cancel(id) reaches the running job's flag");
    }

    #[test]
    fn held_flags_beyond_the_cap_are_freed_once_their_jobs_end() {
        let jobs = AudioJobs::default();
        let held: Vec<_> = (0..MAX_FLAGS + 5).map(|i| jobs.flag(&format!("job-{i}"))).collect();
        drop(held);
        let _ = jobs.flag("next"); // sweeps idle flags
        assert!(jobs.0.lock().unwrap().len() <= 2);
    }

    #[test]
    fn cancel_before_start_survives_the_table_filling_up() {
        let jobs = AudioJobs::default();
        jobs.cancel("late");
        let _held: Vec<_> = (0..MAX_FLAGS).map(|i| jobs.flag(&format!("other-{i}"))).collect(); // the last one sweeps "late"
        assert!(jobs.flag("late").load(Ordering::Relaxed), "the early cancel was kept; the job starts cancelled");
    }

    #[test]
    fn early_cancels_are_bounded_and_forgotten() {
        let jobs = AudioJobs::default();
        for i in 0..MAX_EARLY_CANCELS + 10 {
            jobs.cancel(&format!("c-{i}"));
        }
        jobs.cancel("c-70"); // repeat: not stored twice
        assert_eq!(jobs.2.lock().unwrap().len(), MAX_EARLY_CANCELS);
        assert!(!jobs.2.lock().unwrap().iter().any(|e| e == "c-0"), "the oldest is dropped");
        jobs.forget("c-70");
        assert!(!jobs.2.lock().unwrap().iter().any(|e| e == "c-70"));
        let _held: Vec<_> = (0..MAX_FLAGS).map(|i| jobs.flag(&format!("o-{i}"))).collect();
        assert!(!jobs.flag("c-70").load(Ordering::Relaxed), "forget cleared the early cancel");
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

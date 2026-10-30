//! Repros for review finding 4.
use super::*;

#[test]
#[ignore = "repro for review finding 4a"]
fn finding_4a_cancel_cannot_reach_a_job_when_all_flags_are_held() {
    let jobs = AudioJobs::default();
    let _held: Vec<_> = (0..MAX_FLAGS).map(|i| jobs.flag(&format!("job-{i}"))).collect();
    let mine = jobs.flag("mine"); // unstored
    jobs.cancel("mine");
    assert!(mine.load(Ordering::Relaxed), "cancel(id) did not reach the running job's flag");
}

#[test]
#[ignore = "repro for review finding 4b"]
fn finding_4b_cancel_before_start_is_lost_when_the_table_fills() {
    let jobs = AudioJobs::default();
    jobs.cancel("late"); // entry nobody holds
    let _held: Vec<_> = (0..MAX_FLAGS).map(|i| jobs.flag(&format!("other-{i}"))).collect(); // last one sweeps "late"
    assert!(jobs.flag("late").load(Ordering::Relaxed), "the early cancel was swept; the job starts uncancelled");
}

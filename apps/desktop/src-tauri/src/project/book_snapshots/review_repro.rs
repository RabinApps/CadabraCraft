//! Repros for review findings 2 and 6.
use super::*;
use crate::project::list_trash;
use std::time::Instant;

fn at(s: &str) -> DateTime<Utc> {
    chrono::NaiveDateTime::parse_from_str(s, "%Y%m%d-%H%M").unwrap().and_utc()
}

fn put(d: &Path, rel: &str, text: &str) {
    let p = d.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

fn small_book() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    put(d.path(), "cadabra.json", "{\"v\":1}");
    put(d.path(), "manuscript/001-a.json", "A1");
    d
}

#[test]
#[ignore = "repro for review finding 2"]
fn finding_2_a_named_snapshot_is_pruned_into_an_unlisted_trash_file() {
    let d = small_book();
    let first = create_book_snapshot(d.path(), "My precious named snapshot", at("20260101-0000")).unwrap();
    for i in 1..=MAX_SNAPSHOTS {
        let t = at("20260102-0000") + chrono::Duration::minutes(i as i64);
        create_book_snapshot(d.path(), &format!("named-{i}"), t).unwrap();
    }
    let listed = list_book_snapshots(d.path()).unwrap();
    let in_list = listed.iter().any(|e| e.path == first.path);
    let in_trash_list = list_trash(d.path()).unwrap().iter().any(|e| e.original.contains("20260101-0000"));
    let on_disk: Vec<_> = fs::read_dir(d.path().join(".cadabra/trash")).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    eprintln!("listed={in_list} list_trash={in_trash_list} trash dir={on_disk:?}");
    assert!(in_list, "the oldest NAMED snapshot vanished from the list (on disk in trash: {on_disk:?}, in list_trash: {in_trash_list})");
}

/// Writes a snapshot-shaped file of about `mb` MB. `with_summary` false writes the legacy layout (no `summary` key).
fn write_snap(d: &Path, stamp: &str, mb: usize, with_summary: bool) {
    let text = "x".repeat(mb * 1024 * 1024);
    let summary = if with_summary { "\"summary\":{\"pages\":[\"manuscript/001-a.json\"],\"assets\":0}," } else { "" };
    let body = format!("{{\"version\":1,\"name\":\"s\",\"automatic\":false,{summary}\"manifest\":\"{{}}\",\"pages\":{{\"manuscript/001-a.json\":\"{text}\"}},\"assets\":[]}}");
    put(d, &format!("{SNAPSHOTS_DIR}/{stamp}.json"), &body);
}

#[test]
#[ignore = "repro for review finding 6 (benchmark; prints timings, fails if create takes >100 ms)"]
fn finding_6_create_cost_with_many_snapshots_and_legacy_files() {
    let d = small_book();
    for i in 0..50 {
        write_snap(d.path(), &format!("202601{:02}-{:04}", 1 + i / 24, i % 24 * 10), 1, true);
    }
    for i in 0..3 {
        write_snap(d.path(), &format!("20270101-000{i}"), 30, false);
    }
    let t = Instant::now();
    list_book_snapshots(d.path()).unwrap();
    let list_ms = t.elapsed().as_millis();
    let t = Instant::now();
    create_book_snapshot(d.path(), "one more", at("20250101-0000")).unwrap();
    let create_ms = t.elapsed().as_millis();

    let d2 = small_book();
    for i in 0..50 {
        write_snap(d2.path(), &format!("202601{:02}-{:04}", 1 + i / 24, i % 24 * 10), 1, true);
    }
    let t = Instant::now();
    create_book_snapshot(d2.path(), "one more", at("20250101-0000")).unwrap();
    let create_no_legacy_ms = t.elapsed().as_millis();
    eprintln!("list (50x1MB + 3x30MB legacy): {list_ms} ms; create with legacy: {create_ms} ms; create without legacy: {create_no_legacy_ms} ms");
    assert!(create_ms <= 100, "create_book_snapshot took {create_ms} ms");
}

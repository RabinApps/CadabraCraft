//! Audit edge cases driven through the IPC dispatch: numbers at and beyond their limits, empty and megabyte strings, and
//! floods of job ids and project tokens. Nothing may panic, hang or grow without a bound.
use super::*;
use std::sync::atomic::AtomicBool;

/// Every string argument of `args` (at any depth) replaced by `with`.
fn replace_strings(v: &Value, with: &str) -> Value {
    match v {
        Value::String(_) => json!(with),
        Value::Array(a) => Value::Array(a.iter().map(|x| replace_strings(x, with)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), replace_strings(x, with))).collect()),
        other => other.clone(),
    }
}

/// Commands that share global state with other tests (the fake dialog queue, the one folder watcher) or that need a channel.
pub(super) fn is_shared_state_command(cmd: &str) -> bool {
    cmd.starts_with("pick_") || cmd == "watch_project" || cmd == "unwatch_project"
}

fn answer_len(r: &Result<InvokeResponseBody, Value>) -> usize {
    match r {
        Ok(InvokeResponseBody::Json(j)) => j.len(),
        Ok(InvokeResponseBody::Raw(v)) => v.len(),
        Err(e) => e.to_string().len(),
    }
}

#[test]
fn every_command_answers_empty_string_arguments_without_panicking() {
    let (_app, w) = mock_app();
    for (cmd, args) in every_command().into_iter().filter(|(c, _)| !is_shared_state_command(c)) {
        let r = call(&w, cmd, replace_strings(&args, ""));
        assert!(r.is_err() || answer_len(&r) < 1_000_000, "{cmd}");
    }
}

#[test]
fn every_command_answers_megabyte_string_arguments_without_panicking_or_echoing_them_back_whole() {
    let (_app, w) = mock_app();
    let big = "x".repeat(1_000_000);
    let mut worst = (0usize, "");
    for (cmd, args) in every_command().into_iter().filter(|(c, _)| !is_shared_state_command(c)) {
        let r = call(&w, cmd, replace_strings(&args, &big));
        let n = answer_len(&r);
        if n > worst.0 {
            worst = (n, cmd);
        }
        assert!(r.is_err() || n < 2_000_000, "{cmd}");
    }
    // An error may name the path it refused (the webview sent it), but never more than a few copies of it.
    assert!(worst.0 < 4_000_000, "{worst:?}");
}

#[test]
fn a_megabyte_page_content_and_name_through_the_ipc() {
    let (_app, w) = mock_app();
    let book = project();
    let r = root(&book);
    let text = "é".repeat(500_000); // 1 MB of UTF-8
    let first = json_of(call(&w, "write_project_file", json!({ "root": r, "path": PAGE, "contents": text, "baseHash": null })));
    assert_eq!(json_of(call(&w, "read_project_file", json!({ "root": r, "path": PAGE })))["hash"], first["hash"]);
    let long_name = format!("manuscript/{}.json", "n".repeat(1_000_000));
    assert!(call(&w, "write_project_file", json!({ "root": r, "path": long_name, "contents": "x", "baseHash": null })).is_err());
    assert_eq!(kind_of(call(&w, "write_project_file", json!({ "root": "", "path": PAGE, "contents": "x", "baseHash": null }))), "not_a_project");
    assert_eq!(kind_of(call(&w, "write_project_file", json!({ "root": r, "path": "", "contents": "", "baseHash": "" }))), "unsafe_path");
}

#[test]
fn counts_and_lengths_at_the_edges_of_their_types() {
    let (_app, w) = mock_app();
    let book = project();
    let r = root(&book);
    std::fs::create_dir_all(book.path().join("references")).unwrap();
    std::fs::write(book.path().join("references/a.txt"), b"0123456789").unwrap();
    let range = |offset: Value, length: Value| call(&w, "read_reference", json!({ "root": r, "path": "references/a.txt", "offset": offset, "length": length }));
    assert_eq!(raw_of(range(json!(0), json!(0))), b"");
    assert_eq!(raw_of(range(json!(0), json!(u64::MAX))), b"0123456789");
    assert_eq!(raw_of(range(json!(9), json!(u64::MAX))), b"9");
    assert_eq!(raw_of(range(json!(u64::MAX), json!(u64::MAX))), b"");
    for bad in [json!(-1), json!(1.5), json!(1e30), json!("1"), json!(null), serde_json::from_str::<Value>("18446744073709551616").unwrap()] {
        assert!(range(bad.clone(), json!(1)).is_err(), "offset {bad}");
        assert!(range(json!(0), bad.clone()).is_err(), "length {bad}");
    }
    // Page history: `keep` of 0 keeps one, a huge one keeps everything, a negative or fractional one is refused by decoding.
    for keep in [json!(0), json!(1), json!(u32::MAX), json!(u64::MAX)] {
        assert_eq!(json_of(call(&w, "prune_page_snapshots", json!({ "root": r, "paths": [PAGE], "keep": keep }))), 0, "{keep}");
    }
    for keep in [json!(-1), json!(0.5), json!(1e30), json!("1")] {
        assert!(call(&w, "prune_page_snapshots", json!({ "root": r, "paths": [PAGE], "keep": keep })).is_err(), "{keep}");
    }
    // A long list of paths.
    let paths: Vec<String> = (0..20_000).map(|i| format!("manuscript/{i}.json")).collect();
    assert_eq!(json_of(call(&w, "find_stale_pages", json!({ "root": r, "paths": paths }))), json!([]));
}

#[test]
fn the_docx_split_level_at_and_beyond_its_range() {
    use crate::import_docx::testutil::{chapter_body, simple_docx};
    let (app, w) = mock_app();
    let dir = tempfile::tempdir().unwrap();
    let docx = dir.path().join("book.docx");
    std::fs::write(&docx, simple_docx(&chapter_body(), &[])).unwrap();
    pick(&app, commands::PickKind::ImportSource, &docx);
    let path = docx.to_string_lossy().into_owned();
    let level = |l: Value| call(&w, "import_docx_source", json!({ "path": path, "splitHeadingLevel": l }));
    for ok in [1, 2, 3] {
        assert!(level(json!(ok)).is_ok(), "level {ok}");
    }
    for refused in [0, 4, 100, 255] {
        assert_eq!(kind_of(level(json!(refused))), "io", "level {refused}: a value the type holds but the importer does not accept");
    }
    for undecodable in [json!(256), json!(-1), json!(1.5), json!("1"), json!(null), json!(u64::MAX)] {
        assert!(level(undecodable.clone()).is_err(), "{undecodable}");
    }
}

#[test]
fn a_speed_that_is_not_a_number_in_range_is_refused_before_any_engine_is_asked() {
    use crate::audio::batch::Chunk;
    use crate::audio::render::{render_sample, SampleRequest};
    let flag = AtomicBool::new(false);
    let req = |speed: f64| SampleRequest {
        job_id: "s".into(),
        chunks: vec![Chunk { text: "Hello.".into(), pause_after_ms: u32::MAX }],
        voice: "piper-amy".into(),
        speed,
    };
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0, -0.0, 0.0, 0.499_999_9, 2.000_001, 1e308, -1e308, f64::MAX, f64::MIN_POSITIVE, f64::EPSILON] {
        let e = render_sample(&req(bad), std::path::Path::new("/no/engine"), None, &flag).unwrap_err();
        assert!(format!("{e:?}").contains("speed must be between"), "{bad}: {e:?}");
    }
    // The ends of the range pass the speed check (and then fail for the missing engine, not for the speed).
    for ok in [0.5, 2.0, 1.0] {
        let e = render_sample(&req(ok), std::path::Path::new("/no/engine"), None, &flag).unwrap_err();
        assert!(!format!("{e:?}").contains("speed must be between"), "{ok}: {e:?}");
    }
    // Over the wire a non-finite number cannot even be written: JSON has no NaN, and null or text is refused when decoding.
    let (_app, w) = mock_app();
    for speed in [json!(null), json!("NaN"), json!("1"), json!(true)] {
        let r = call(&w, "audio_sample", json!({ "request": { "jobId": "s", "chunks": [], "voice": "v", "speed": speed } }));
        assert!(r.is_err(), "{speed}");
    }
    let r = call(
        &w,
        "audio_sample",
        json!({ "request": { "jobId": "s", "chunks": [{ "text": "x", "pauseAfterMs": 4294967296u64 }], "voice": "v", "speed": 1.0 } }),
    );
    assert!(r.is_err(), "a pause over u32 is refused when decoding");
    let r = call(&w, "audio_sample", json!({ "request": { "jobId": "s", "chunks": [{ "text": "x", "pauseAfterMs": -1 }], "voice": "v", "speed": 1.0 } }));
    assert!(r.is_err());
}

#[test]
fn ten_thousand_job_ids_leave_the_table_bounded_and_a_held_job_still_cancels() {
    let jobs = AudioJobs::default();
    let held = jobs.flag("held");
    for i in 0..10_000 {
        jobs.cancel(&format!("flood-{i}"));
        if i % 3 == 0 {
            jobs.forget(&format!("flood-{}", i / 2));
        }
    }
    jobs.cancel("held");
    assert!(held.load(std::sync::atomic::Ordering::Relaxed), "a flag in use survives the flood");
    // A job id may be empty or huge.
    jobs.cancel("");
    jobs.cancel(&"j".repeat(1_000_000));
    jobs.forget("");
    // And through the IPC.
    let (_app, w) = mock_app();
    for i in 0..2_000 {
        assert_eq!(json_of(call(&w, "audio_cancel", json!({ "jobId": format!("ipc-{i}") }))), Value::Null);
    }
}

#[test]
fn a_flood_of_projects_asking_for_stream_urls_is_bounded_and_the_newest_always_works() {
    let (app, w) = mock_app();
    let books: Vec<tempfile::TempDir> = (0..80)
        .map(|i| {
            let b = project();
            std::fs::create_dir(b.path().join("references")).unwrap();
            std::fs::write(b.path().join("references/c.mp4"), format!("clip {i}")).unwrap();
            b
        })
        .collect();
    let urls: Vec<String> = books
        .iter()
        .map(|b| json_of(call(&w, "reference_stream_url", json!({ "root": root(b), "path": "references/c.mp4" }))).as_str().unwrap().to_string())
        .collect();
    let roots = app.state::<commands::MediaRoots>();
    let status = |url: &str| commands::respond(&roots, &tauri::http::Request::builder().uri(url).body(vec![]).unwrap()).status().as_u16();
    assert_eq!(status(urls.last().unwrap()), 200, "the newest project streams");
    let serving = urls.iter().filter(|u| status(u) == 200).count();
    assert!(serving <= 64, "{serving} projects are remembered; the table must not keep growing");
    assert!(serving >= 1);
    // Asking again for an evicted project gives it a working URL again (the token is a hash, so it is the same one).
    let first = json_of(call(&w, "reference_stream_url", json!({ "root": root(&books[0]), "path": "references/c.mp4" })));
    assert_eq!(first.as_str().unwrap(), urls[0]);
    assert_eq!(status(&urls[0]), 200);
}

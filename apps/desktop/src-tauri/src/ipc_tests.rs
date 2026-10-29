//! The command layer driven through Tauri's mock runtime: every request goes through the real IPC dispatch, so the
//! generated handler code (argument decoding, `State` and `Channel` injection, response encoding) runs, with the same
//! command names and wire format the webview uses. The command bodies are tested next to their definitions.
use crate::audio::AudioJobs;
use crate::commands::testutil::{project, root, text};
use crate::platform::fs_watch::WatchState;
use crate::{audio, commands, fonts, typst}; // the `app_handlers!` macro (lib.rs) names these modules
use serde_json::{json, Value};
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, Manager, WebviewWindow, WebviewWindowBuilder};

/// The app as `run()` builds it (same managed state, same handlers), on the mock runtime, plus one window to call from.
fn mock_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    build_app(true)
}

/// `with_state: false` leaves `WatchState`, `AudioJobs`, `MediaRoots` and `PickedPaths` unmanaged, as a build that forgot `.manage` would be.
fn build_app(with_state: bool) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let builder = mock_builder();
    let builder = if with_state { builder.manage(WatchState::default()).manage(AudioJobs::default()).manage(commands::MediaRoots::default()).manage(commands::PickedPaths::default()) } else { builder };
    let app = builder.invoke_handler(app_handlers![]).build(mock_context(noop_assets())).expect("the mock app builds");
    let window = WebviewWindowBuilder::new(&app, "main", Default::default()).build().expect("the mock window builds");
    (app, window)
}

/// What the native dialogs do in the real app: remember a path the author chose.
fn pick(app: &App<MockRuntime>, kind: commands::PickKind, path: &std::path::Path) {
    app.state::<commands::PickedPaths>().record(kind, path).unwrap();
}

fn request(cmd: &str, body: InvokeBody, headers: &[(&str, String)]) -> InvokeRequest {
    let mut map = tauri::http::HeaderMap::new();
    for (k, v) in headers {
        map.insert(tauri::http::HeaderName::from_bytes(k.as_bytes()).unwrap(), tauri::http::HeaderValue::from_str(v).unwrap());
    }
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" }.parse().unwrap(), // the app's own (local) origin
        body,
        headers: map,
        invoke_key: INVOKE_KEY.to_string(),
    }
}

/// Calls a command with JSON arguments; `Err` is the JSON error the webview would get.
fn call(w: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<InvokeResponseBody, Value> {
    get_ipc_response(w, request(cmd, InvokeBody::Json(args), &[]))
}

fn json_of(r: Result<InvokeResponseBody, Value>) -> Value {
    serde_json::from_str(&text(r.expect("the command succeeds"))).unwrap()
}

fn kind_of(r: Result<InvokeResponseBody, Value>) -> String {
    r.expect_err("the command fails")["kind"].as_str().unwrap().to_string()
}

fn raw_of(r: Result<InvokeResponseBody, Value>) -> Vec<u8> {
    match r.expect("the command succeeds") {
        InvokeResponseBody::Raw(v) => v,
        InvokeResponseBody::Json(j) => panic!("expected a binary response, got {j}"),
    }
}

const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];
const PAGE: &str = "manuscript/001-a.json";

#[test]
fn project_commands_work_through_the_ipc() {
    let (app, w) = mock_app();
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path().to_string_lossy().into_owned();
    assert_eq!(json_of(call(&w, "read_project_file", json!({ "root": r, "path": "cadabra.json" }))), Value::Null);
    assert_eq!(kind_of(call(&w, "create_project", json!({ "root": r, "manifestJson": "{}" }))), "not_picked", "a folder nobody picked");
    assert!(!dir.path().join("cadabra.json").exists());
    pick(&app, commands::PickKind::Folder, dir.path());
    assert_eq!(json_of(call(&w, "create_project", json!({ "root": r, "manifestJson": "{}" }))), Value::Null);
    assert_eq!(kind_of(call(&w, "create_project", json!({ "root": r, "manifestJson": "{}" }))), "already_exists");
    assert_eq!(json_of(call(&w, "read_project_file", json!({ "root": r, "path": "cadabra.json" })))["contents"], "{}");
    let first = json_of(call(&w, "write_project_file", json!({ "root": r, "path": PAGE, "contents": "one", "baseHash": null })));
    json_of(call(&w, "write_project_file", json!({ "root": r, "path": PAGE, "contents": "two", "baseHash": first["hash"] })));
    assert!(json_of(call(&w, "backup_manifest", json!({ "root": r }))).as_str().unwrap().starts_with(".cadabra/backups/"));
    let trashed = json_of(call(&w, "trash_project_file", json!({ "root": r, "path": PAGE })));
    let listed = json_of(call(&w, "list_project_trash", json!({ "root": r })));
    assert_eq!(listed[0]["path"], trashed);
    assert_eq!(json_of(call(&w, "restore_project_trash", json!({ "root": r, "path": trashed }))), PAGE);
    assert_eq!(kind_of(call(&w, "trash_project_file", json!({ "root": r, "path": "manuscript/missing.json" }))), "not_found");
}

#[test]
fn raw_byte_writes_use_headers_and_land_under_exports() {
    let (_app, w) = mock_app();
    let book = project();
    let enc = |s: String| s.replace('/', "%2F");
    let headers = [("root", enc(root(&book))), ("path", "exports%2Fa.bin".to_string())];
    let r = get_ipc_response(&w, request("write_project_bytes", InvokeBody::Raw(vec![1, 2, 3]), &headers));
    assert_eq!(json_of(r), Value::Null);
    assert_eq!(std::fs::read(book.path().join("exports/a.bin")).unwrap(), vec![1, 2, 3]);
    let bad = [("root", enc(root(&book))), ("path", "manuscript%2Fa.json".to_string())];
    assert!(get_ipc_response(&w, request("write_project_bytes", InvokeBody::Raw(vec![1]), &bad)).is_err());
}

#[test]
fn snapshot_commands_work_through_the_ipc() {
    let (_app, w) = mock_app();
    let book = project();
    let r = root(&book);
    let first = json_of(call(&w, "write_project_file", json!({ "root": r, "path": PAGE, "contents": "one", "baseHash": null })));
    json_of(call(&w, "write_project_file", json!({ "root": r, "path": PAGE, "contents": "two", "baseHash": first["hash"] })));
    let snaps = json_of(call(&w, "list_page_snapshots", json!({ "root": r, "path": PAGE })));
    let snap = snaps[0]["path"].clone();
    assert_eq!(json_of(call(&w, "read_page_snapshot", json!({ "root": r, "path": PAGE, "snapshot": snap })))["contents"], "one");
    assert!(json_of(call(&w, "restore_page_snapshot", json!({ "root": r, "path": PAGE, "snapshot": snap })))["hash"].is_string());
    assert_eq!(json_of(call(&w, "prune_page_snapshots", json!({ "root": r, "paths": [PAGE], "keep": 50 }))), 0);
    assert_eq!(json_of(call(&w, "find_stale_pages", json!({ "root": r, "paths": [PAGE] }))), json!([]));
    assert!(call(&w, "list_page_snapshots", json!({ "root": r })).is_err(), "a missing argument is refused");
}

#[test]
fn asset_and_import_commands_work_through_the_ipc() {
    let (app, w) = mock_app();
    let (book, src) = (project(), tempfile::tempdir().unwrap());
    let r = root(&book);
    std::fs::write(src.path().join("cover.png"), PNG).unwrap();
    std::fs::write(src.path().join("book.md"), "# Hi").unwrap();
    let cover = src.path().join("cover.png").to_string_lossy().into_owned();
    let md = src.path().join("book.md").to_string_lossy().into_owned();
    assert_eq!(kind_of(call(&w, "import_asset", json!({ "root": r, "source": cover }))), "not_picked");
    assert_eq!(kind_of(call(&w, "read_import_source", json!({ "path": md }))), "not_picked");
    assert_eq!(kind_of(call(&w, "read_import_image", json!({ "sourceFile": md, "reference": "a.png" }))), "not_picked");
    pick(&app, commands::PickKind::Image, &src.path().join("cover.png"));
    pick(&app, commands::PickKind::ImportSource, &src.path().join("book.md"));
    let rel = json_of(call(&w, "import_asset", json!({ "root": r, "source": cover })));
    assert!(rel.as_str().unwrap().starts_with("assets/"), "{rel}");
    let stored = json_of(call(&w, "import_asset_bytes", json!({ "root": r, "name": "map.png", "bytes": PNG })));
    assert!(stored.as_str().unwrap().starts_with("assets/"), "{stored}");
    assert_eq!(raw_of(call(&w, "read_asset", json!({ "root": r, "path": rel }))), PNG);
    assert_eq!(kind_of(call(&w, "read_asset", json!({ "root": r, "path": "assets/none.png" }))), "not_found");
    assert_eq!(raw_of(call(&w, "read_import_source", json!({ "path": md }))), b"# Hi");
    assert!(call(&w, "read_import_image", json!({ "sourceFile": md, "reference": "../x.png" })).is_err());
    std::fs::write(src.path().join("a.png"), PNG).unwrap();
    assert_eq!(raw_of(call(&w, "read_import_image", json!({ "sourceFile": md, "reference": "a.png" }))), PNG);
}

#[test]
fn reference_commands_work_through_the_ipc() {
    let (_app, w) = mock_app();
    let (book, src) = (project(), tempfile::tempdir().unwrap());
    let r = root(&book);
    std::fs::write(src.path().join("notes.md"), "# Notes").unwrap();
    std::fs::write(src.path().join("run.exe"), "MZ").unwrap();
    let notes = src.path().join("notes.md").to_string_lossy().into_owned();
    let got = json_of(call(&w, "import_reference", json!({ "root": r, "source": notes })));
    assert_eq!(got, json!({ "file": "references/notes.md", "title": "notes", "size": 7, "kind": "text", "reused": false }));
    assert_eq!(json_of(call(&w, "stat_reference", json!({ "root": r, "path": "references/notes.md" }))), json!({ "size": 7, "kind": "text" }));
    assert_eq!(raw_of(call(&w, "read_reference", json!({ "root": r, "path": "references/notes.md", "offset": 2, "length": 99 }))), b"Notes");
    let exe = src.path().join("run.exe").to_string_lossy().into_owned();
    assert_eq!(kind_of(call(&w, "import_reference", json!({ "root": r, "source": exe }))), "unsupported_reference");
    assert_eq!(kind_of(call(&w, "open_reference", json!({ "root": r, "path": "assets/a.png" }))), "not_reference");
    assert!(json_of(call(&w, "trash_reference", json!({ "root": r, "path": "references/notes.md" }))).as_str().unwrap().starts_with(".cadabra/trash/"));
    assert_eq!(kind_of(call(&w, "stat_reference", json!({ "root": r, "path": "references/notes.md" }))), "not_found");
}

#[test]
fn a_video_reference_gets_a_stream_url_the_scheme_then_serves() {
    use tauri::Manager;
    let (app, w) = mock_app();
    let book = project();
    std::fs::create_dir(book.path().join("references")).unwrap();
    std::fs::write(book.path().join("references/clip.mp4"), b"0123456789").unwrap();
    std::fs::write(book.path().join("references/pic.png"), b"x").unwrap();
    let r = root(&book);
    let url = json_of(call(&w, "reference_stream_url", json!({ "root": r, "path": "references/clip.mp4" })));
    let url = url.as_str().unwrap();
    assert!(url.starts_with(if cfg!(windows) { "http://cadabra-ref.localhost/" } else { "cadabra-ref://localhost/" }), "{url}");
    assert!(!url.contains(&r), "the URL holds a token, not the folder");
    assert_eq!(kind_of(call(&w, "reference_stream_url", json!({ "root": r, "path": "references/pic.png" }))), "unsupported_reference");
    assert_eq!(kind_of(call(&w, "reference_stream_url", json!({ "root": r, "path": "assets/a.mp4" }))), "not_reference");
    assert_eq!(kind_of(call(&w, "reference_stream_url", json!({ "root": "/not/a/project", "path": "references/clip.mp4" }))), "not_a_project");
    let req = tauri::http::Request::builder().uri(url).header("range", "bytes=1-3").body(vec![]).unwrap();
    let res = commands::respond(&app.state::<commands::MediaRoots>(), &req);
    assert_eq!((res.status().as_u16(), res.body().as_slice()), (206, &b"123"[..]));
}

#[test]
fn updates_supported_answers_a_bool() {
    let (_app, w) = mock_app();
    assert_eq!(json_of(call(&w, "updates_supported", json!({}))), json!(crate::commands::updates_supported()));
}

#[test]
fn watch_project_emits_project_changed_with_the_relative_path() {
    let (app, w) = mock_app();
    let book = project();
    let canonical = std::fs::canonicalize(book.path()).unwrap(); // FSEvents reports real paths
    std::fs::create_dir_all(canonical.join("manuscript")).unwrap();
    let r = canonical.to_string_lossy().into_owned();
    let (tx, rx) = channel();
    app.listen("project-changed", move |e| drop(tx.send(e.payload().to_string())));
    json_of(call(&w, "watch_project", json!({ "root": r })));
    std::fs::write(canonical.join("manuscript/001-a.json"), "{}").unwrap();
    let seen: Vec<String> = std::iter::from_fn(|| rx.recv_timeout(Duration::from_secs(20)).ok()).take_while(|p| p != "\"manuscript/001-a.json\"").collect();
    assert!(seen.iter().all(|p| !p.contains(".cadabra")), "{seen:?}");
    let plain = tempfile::tempdir().unwrap();
    assert!(call(&w, "watch_project", json!({ "root": plain.path().to_string_lossy() })).is_err());
}

#[test]
fn typst_commands_work_through_the_ipc() {
    let (_app, w) = mock_app();
    // The program is never chosen by the caller: a `typstPath` argument is ignored. The result depends only on the
    // bundled typst (or, in debug builds, the environment's): it answers, or it is not found.
    for cmd in ["typst_find", "typst_list_fonts"] {
        for args in [json!({}), json!({ "typstPath": "/bin/sh" })] {
            if let Err(e) = call(&w, cmd, args) {
                assert_eq!(e["kind"], "not_found", "{cmd}: {e}");
            }
        }
    }
    // A binary body goes through `typst_compile`; a malformed one is refused, and so is a JSON one.
    assert_eq!(kind_of(get_ipc_response(&w, request("typst_compile", InvokeBody::Raw(vec![1, 2]), &[]))), "other");
    assert_eq!(kind_of(call(&w, "typst_compile", json!({}))), "other");
    assert_eq!(kind_of(get_ipc_response(&w, request("typst_query", InvokeBody::Raw(vec![1, 2]), &[]))), "other");
    assert_eq!(kind_of(call(&w, "typst_query", json!({}))), "other");
}

#[test]
fn audio_commands_work_through_the_ipc() {
    let (_app, w) = mock_app();
    let voices = json_of(call(&w, "audio_voices", json!({})));
    assert_eq!(voices.as_array().unwrap().len(), 3);
    assert_eq!(json_of(call(&w, "audio_packs", json!({}))).as_array().unwrap().len(), 2);
    let book = tempfile::tempdir().unwrap();
    std::fs::write(book.path().join("a.opus"), "x").unwrap();
    let r = root(&book);
    assert!(call(&w, "audio_files_exist", json!({ "root": r, "paths": ["a.opus"] })).is_err(), "not a project yet");
    std::fs::write(book.path().join("cadabra.json"), "{}").unwrap();
    assert_eq!(json_of(call(&w, "audio_files_exist", json!({ "root": r, "paths": ["a.opus", "nope"] }))), json!([true, false]));
    assert!(call(&w, "audio_files_exist", json!({ "root": r, "paths": ["../a.opus"] })).is_err());
    // The state-injected commands: the job flags live in the managed `AudioJobs`.
    assert_eq!(json_of(call(&w, "audio_cancel", json!({ "jobId": "j" }))), Value::Null);
    assert_eq!(json_of(call(&w, "audio_forget", json!({ "jobId": "j" }))), Value::Null);
    // An unknown pack is refused before anything is downloaded; the progress channel is decoded on the way.
    let unknown = call(&w, "audio_download_pack", json!({ "pack": "nope", "jobId": "d", "onProgress": "__CHANNEL__:1" }));
    assert!(unknown.unwrap_err()["message"].as_str().unwrap().contains("unknown voice pack"));
    assert!(call(&w, "audio_delete_pack", json!({ "pack": "nope" })).is_err());
    // The renderers look for an engine first; the outcome depends on this computer's PATH, so only the plumbing is checked:
    // a request that decodes reaches the command (an answer comes back), one that does not is refused as bad input.
    let chunk_less = json!({ "jobId": "r", "root": r, "base": "exports/audio/c", "chunks": [], "voice": "piper-amy", "speed": 1.0, "formats": [] });
    let _ = call(&w, "audio_render_chapter", json!({ "request": chunk_less, "onProgress": "__CHANNEL__:2" }));
    let _ = call(&w, "audio_sample", json!({ "request": { "jobId": "s", "chunks": [], "voice": "piper-amy", "speed": 1.0 } }));
    let m4b = json!({ "jobId": "m", "root": r, "base": "exports/audio/b", "title": "T", "author": "A", "cover": null, "chapters": [] });
    let _ = call(&w, "audio_build_m4b", json!({ "request": m4b }));
    assert!(call(&w, "audio_sample", json!({ "request": {} })).is_err());
    assert!(call(&w, "audio_build_m4b", json!({})).is_err());
}

/// Every command with a valid set of arguments. Dropping any one of them, or sending it as the wrong type, must be refused as
/// bad input by the generated decoding (the command body never runs).
fn every_command() -> Vec<(&'static str, Value)> {
    let chunk_less = json!({ "jobId": "r", "root": "/r", "base": "b", "chunks": [], "voice": "v", "speed": 1.0, "formats": [] });
    vec![
        ("pick_folder", json!({})),
        ("pick_image", json!({})),
        ("pick_import_source", json!({})),
        ("create_project", json!({ "root": "/r", "manifestJson": "{}" })),
        ("read_project_file", json!({ "root": "/r", "path": "p" })),
        ("write_project_file", json!({ "root": "/r", "path": "p", "contents": "c" })),
        ("backup_manifest", json!({ "root": "/r" })),
        ("trash_project_file", json!({ "root": "/r", "path": "p" })),
        ("list_project_trash", json!({ "root": "/r" })),
        ("restore_project_trash", json!({ "root": "/r", "path": "p" })),
        ("list_page_snapshots", json!({ "root": "/r", "path": "p" })),
        ("read_page_snapshot", json!({ "root": "/r", "path": "p", "snapshot": "s" })),
        ("restore_page_snapshot", json!({ "root": "/r", "path": "p", "snapshot": "s" })),
        ("prune_page_snapshots", json!({ "root": "/r", "paths": [], "keep": 1 })),
        ("find_stale_pages", json!({ "root": "/r", "paths": [] })),
        ("import_asset", json!({ "root": "/r", "source": "/s" })),
        ("import_asset_bytes", json!({ "root": "/r", "name": "n", "bytes": [] })),
        ("read_asset", json!({ "root": "/r", "path": "p" })),
        ("import_reference", json!({ "root": "/r", "source": "/s" })),
        ("stat_reference", json!({ "root": "/r", "path": "p" })),
        ("read_reference", json!({ "root": "/r", "path": "p", "offset": 0, "length": 1 })),
        ("trash_reference", json!({ "root": "/r", "path": "p" })),
        ("open_reference", json!({ "root": "/r", "path": "p" })),
        ("reference_stream_url", json!({ "root": "/r", "path": "p" })),
        ("read_import_source", json!({ "path": "/p" })),
        ("read_import_image", json!({ "sourceFile": "/p", "reference": "r" })),
        ("watch_project", json!({ "root": "/r" })),
        ("audio_files_exist", json!({ "root": "/r", "paths": [] })),
        ("audio_cancel", json!({ "jobId": "j" })),
        ("audio_forget", json!({ "jobId": "j" })),
        ("audio_render_chapter", json!({ "request": chunk_less, "onProgress": "__CHANNEL__:1" })),
        ("audio_sample", json!({ "request": { "jobId": "s", "chunks": [], "voice": "v", "speed": 1.0 } })),
        ("audio_build_m4b", json!({ "request": { "jobId": "m", "root": "/r", "base": "b", "title": "T", "author": "A", "chapters": [] } })),
        ("audio_download_pack", json!({ "pack": "nope", "jobId": "d", "onProgress": "__CHANNEL__:2" })),
        ("audio_delete_pack", json!({ "pack": "nope" })),
        ("fonts_download", json!({ "fontId": "nope", "jobId": "d", "onProgress": "__CHANNEL__:3" })),
        ("fonts_cancel", json!({ "jobId": "j" })),
        ("fonts_import", json!({ "srcPath": "/no/such/font.woff2" })),
        ("fonts_delete", json!({ "fontId": "../nope" })),
        ("fonts_data", json!({ "fontId": "../nope", "file": "x.ttf" })),
    ]
}

#[test]
fn a_missing_or_mistyped_argument_is_refused_before_the_command_runs() {
    let (_app, w) = mock_app();
    for (cmd, args) in every_command() {
        for key in args.as_object().unwrap().keys() {
            let mut without = args.clone();
            without.as_object_mut().unwrap().remove(key);
            let err = call(&w, cmd, without).expect_err(&format!("{cmd} without {key}"));
            assert!(err.as_str().is_some_and(|m| m.contains(key)), "{cmd} without {key}: {err}");
            let mut wrong = args.clone();
            wrong[key] = json!({ "wrong": [true] });
            assert!(call(&w, cmd, wrong).is_err(), "{cmd} with a mistyped {key}");
        }
    }
}

#[test]
fn an_optional_argument_may_be_absent_or_null_but_not_mistyped() {
    let (_app, w) = mock_app();
    {
        let (cmd, key) = ("write_project_file", "baseHash");
        let args = json!({ "root": "/not/a/project", "path": "p", "contents": "c" });
        let mut wrong = args.clone();
        wrong[key] = json!({ "wrong": [true] });
        let err = call(&w, cmd, wrong).expect_err(cmd);
        assert!(err.as_str().is_some_and(|m| m.contains(key)), "{cmd}: {err}");
    }
}

#[test]
fn commands_that_need_managed_state_are_refused_when_it_is_missing() {
    let (_app, w) = build_app(false);
    for (cmd, args) in every_command() {
        let needs_state = matches!(
            cmd,
            "watch_project"
                | "pick_folder"
                | "pick_image"
                | "pick_import_source"
                | "create_project"
                | "import_asset"
                | "read_import_source"
                | "read_import_image"
                | "reference_stream_url"
                | "audio_cancel"
                | "audio_forget"
                | "audio_render_chapter"
                | "audio_sample"
                | "audio_build_m4b"
                | "audio_download_pack"
                | "fonts_download"
                | "fonts_cancel"
        );
        if needs_state {
            // (the others are not called: their arguments are placeholders for paths that must never be touched)
            let err = call(&w, cmd, args).expect_err(cmd);
            assert!(err.as_str().is_some_and(|m| m.contains("state not managed")), "{cmd}: {err}");
        }
    }
}

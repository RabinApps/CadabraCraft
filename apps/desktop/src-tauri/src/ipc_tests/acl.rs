//! The command allow-list and the capability file must not drift apart. Tauri 2 lets a window call every command the
//! builder registers once a capability covers the window (there is no per-command ACL yet, see docs/architecture.md,
//! "Rust hardening"), and a mock runtime ignores capabilities, so this reads the real files: the handler list in
//! `lib.rs`, `capabilities/default.json` and `tauri.conf.json`.
use super::*;
use std::collections::BTreeSet;

const LIB: &str = include_str!("../lib.rs");
const CAPABILITY: &str = include_str!("../../capabilities/default.json");
const CONFIG: &str = include_str!("../../tauri.conf.json");

/// Commands the JSON-argument table (`every_command`) cannot drive: raw-body writers (request headers), commands without arguments and the
/// Typst commands (tested next to their definitions).
const NOT_IN_THE_TABLE: [&str; 11] = [
    "write_project_bytes",
    "import_asset_bytes",
    "updates_supported",
    "audio_voices",
    "audio_packs",
    "fonts_catalog",
    "fonts_installed",
    "typst_find",
    "typst_list_fonts",
    "typst_compile",
    "typst_query",
];

/// The command names listed in the handler macro of `lib.rs` (last path segment of each entry).
fn registered_commands() -> BTreeSet<String> {
    let marker = "tauri::generate_handler![";
    let body = &LIB[LIB.find(marker).expect("the handler list exists") + marker.len()..];
    let body = &body[..body.find("$(, $extra)*").expect("the handler list ends with the extras")];
    body.split(',').map(|e| e.trim().rsplit("::").next().unwrap_or("").to_string()).filter(|n| !n.is_empty()).collect()
}

fn capability() -> Value {
    serde_json::from_str(CAPABILITY).expect("capabilities/default.json is JSON")
}

/// The permission identifiers of the capability, whether written as a string or as a scoped object.
fn permission_ids(cap: &Value) -> Vec<String> {
    let list = cap["permissions"].as_array().expect("permissions is a list");
    list.iter().map(|p| p.as_str().or_else(|| p["identifier"].as_str()).expect("every permission has an identifier").to_string()).collect()
}

#[test]
fn the_handler_list_is_read_whole() {
    let names = registered_commands();
    assert!(names.len() > 50, "found {} commands", names.len());
    for known in ["read_project_file", "audio_build_m4b", "fonts_data", "typst_compile", "read_license"] {
        assert!(names.contains(known), "{known} is missing from the parsed list");
    }
    assert!(
        names.iter().all(|n| n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')),
        "a path or macro fragment leaked into the list: {names:?}"
    );
}

#[test]
fn every_registered_command_resolves_through_the_real_handler() {
    let (_app, w) = mock_app();
    let probe = |cmd: &str| call(&w, cmd, json!({})).err().map(|e| e.to_string()).unwrap_or_default();
    let unknown = probe("no_such_command_anywhere");
    assert!(unknown.contains("no_such_command_anywhere"), "an unregistered command is refused by name: {unknown}");
    for cmd in registered_commands() {
        assert_ne!(probe(&cmd), unknown.replace("no_such_command_anywhere", &cmd), "{cmd} is listed in lib.rs but the handler does not know it");
    }
}

#[test]
fn every_registered_command_is_in_the_ipc_argument_table() {
    let table: BTreeSet<String> = every_command().into_iter().map(|(name, _)| name.to_string()).collect();
    let registered = registered_commands();
    let missing: Vec<&String> = registered.iter().filter(|c| !table.contains(*c) && !NOT_IN_THE_TABLE.contains(&c.as_str())).collect();
    assert!(missing.is_empty(), "add these commands to every_command() in ipc_tests.rs: {missing:?}");
    let stale: Vec<&String> = table.iter().filter(|c| !registered.contains(*c)).collect();
    assert!(stale.is_empty(), "every_command() lists commands that are not registered: {stale:?}");
    for name in NOT_IN_THE_TABLE {
        assert!(registered.contains(name), "{name} is excused above but not registered");
        assert!(!table.contains(name), "{name} is in the table, drop it from the excused list");
    }
}

#[test]
fn the_capability_covers_exactly_the_main_window() {
    let cap = capability();
    let windows: Vec<&str> = cap["windows"].as_array().expect("windows is a list").iter().filter_map(Value::as_str).collect();
    assert_eq!(windows, ["main"], "only the main window may call commands");
    assert!(cap.get("webviews").is_none() && cap.get("remote").is_none(), "no extra webviews and no remote URLs");
    let config: Value = serde_json::from_str(CONFIG).expect("tauri.conf.json is JSON");
    let configured = config["app"]["windows"].as_array().expect("windows are configured");
    let labels: Vec<&str> = configured.iter().map(|w| w["label"].as_str().unwrap_or("main")).collect();
    assert_eq!(labels, ["main"], "the configured windows are the ones the capability names");
}

#[test]
fn every_capability_permission_belongs_to_a_registered_plugin() {
    let ids = permission_ids(&capability());
    assert!(ids.iter().any(|i| i == "core:default"));
    let unique: BTreeSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len(), "a permission is listed twice");
    for id in ids {
        let (plugin, rest) = id.split_once(':').unwrap_or_else(|| panic!("{id} has no plugin prefix"));
        assert!(!rest.is_empty() && !id.contains('*'), "{id} is a wildcard");
        if plugin != "core" {
            assert!(LIB.contains(&format!("tauri_plugin_{plugin}::")), "{id}: lib.rs does not register the {plugin} plugin");
        }
    }
}

#[test]
fn the_open_url_permission_is_scoped_to_known_https_addresses() {
    let cap = capability();
    let scoped = cap["permissions"].as_array().unwrap().iter().find(|p| p["identifier"] == "opener:allow-open-url");
    let allow = scoped.expect("the opener permission is scoped")["allow"].as_array().expect("an allow list");
    assert!(!allow.is_empty());
    for entry in allow {
        let url = entry["url"].as_str().expect("a url scope");
        assert!(url.starts_with("https://github.com/") || url.starts_with("https://raw.githubusercontent.com/"), "{url}");
    }
    let ids = permission_ids(&cap);
    assert!(!ids.iter().any(|i| i == "opener:default" || i.starts_with("shell:")), "the unscoped opener or shell is not granted");
}

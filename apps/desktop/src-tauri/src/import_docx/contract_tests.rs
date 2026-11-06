//! Runs the shared fixtures in `fixtures/docx`: each `<name>.docx` has a `<name>.json` with the options it was imported
//! with and what `packages/import-docx` produced (`result`: chapters, warnings and assets with their length and sha-256,
//! or `error`: the error code). The TypeScript twin is `packages/import-docx/src/__tests__/contract.test.ts`; both must
//! agree on every file, so a change to either importer that changes the output fails the other suite until the fixtures are
//! regenerated on purpose (`UPDATE_DOCX_FIXTURES=1 pnpm --filter @cadabracraft/import-docx test`).
//!
//! `DOCX_CONTRACT_DIR=<dir>` runs the same check on any folder of such pairs (used to compare against a larger corpus).
use super::{import_docx, ImportResult, Options};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn fixture_dir() -> PathBuf {
    match std::env::var("DOCX_CONTRACT_DIR") {
        Ok(d) => PathBuf::from(d),
        Err(_) => PathBuf::from(format!("{}/../../../fixtures/docx", env!("CARGO_MANIFEST_DIR"))),
    }
}

fn options(spec: &Value) -> Options {
    let mut o = Options::default();
    let opts = &spec["options"];
    if let Some(v) = opts["splitHeadingLevel"].as_u64() {
        o.split_heading_level = v as u8;
    }
    if let Some(v) = opts["untitledTitle"].as_str() {
        o.untitled_title = v.to_string();
    }
    if let Some(v) = opts["maxDecompressedBytes"].as_u64() {
        o.max_decompressed_bytes = v;
    }
    if let Some(v) = opts["maxEntries"].as_u64() {
        o.max_entries = v as usize;
    }
    if let Some(v) = opts["maxNestingDepth"].as_u64() {
        o.max_nesting_depth = v as u32;
    }
    o
}

/// JavaScript can hold a lone surrogate (JSON writes it as `\\ud83d`); a Rust string cannot. The only place the TypeScript
/// importer makes one is where it cuts a warning example in the middle of an emoji (`slice(0, 80)`), and the Rust importer
/// drops that half character, so the escapes are removed from the expected text before it is parsed.
fn without_lone_surrogates(json: &str) -> String {
    let b = json.as_bytes();
    let mut out = String::with_capacity(json.len());
    let unit = |i: usize| -> Option<u32> {
        json.get(i + 2..i + 6).filter(|_| b.get(i) == Some(&b'\\') && b.get(i + 1) == Some(&b'u')).and_then(|h| u32::from_str_radix(h, 16).ok())
    };
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' {
            match unit(i) {
                Some(hi @ 0xd800..=0xdbff) if matches!(unit(i + 6), Some(0xdc00..=0xdfff)) => {
                    out.push_str(&json[i..i + 12]);
                    i += 12;
                    let _ = hi;
                }
                Some(0xd800..=0xdfff) => i += 6,
                Some(_) => {
                    out.push_str(&json[i..i + 6]);
                    i += 6;
                }
                None => {
                    out.push_str(&json[i..i + 2]);
                    i += 2;
                }
            }
        } else {
            let ch = json[i..].chars().next().unwrap_or('\u{fffd}');
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// The result in the shape the fixtures hold (assets without their bytes, plus the bytes' sha-256).
fn as_json(r: &ImportResult) -> Value {
    json!({
        "chapters": serde_json::to_value(&r.chapters).unwrap(),
        "warnings": serde_json::to_value(&r.warnings).unwrap(),
        "assets": r.assets.iter().map(|a| json!({
            "sourcePath": a.source_path, "targetPath": a.target_path, "mediaType": a.media_type, "len": a.bytes.len(),
            "sha256": Sha256::digest(&a.bytes).iter().map(|b| format!("{b:02x}")).collect::<String>(),
        })).collect::<Vec<_>>(),
    })
}

/// The first place two JSON values differ, for a readable failure.
fn first_difference(a: &Value, b: &Value, path: &str) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    Some(w) => {
                        if let Some(d) = first_difference(v, w, &format!("{path}.{k}")) {
                            return Some(d);
                        }
                    }
                    None => return Some(format!("{path}.{k} is only in the expected output")),
                }
            }
            y.keys().find(|k| !x.contains_key(*k)).map(|k| format!("{path}.{k} is only in the actual output"))
        }
        (Value::Array(x), Value::Array(y)) => {
            for (i, (v, w)) in x.iter().zip(y).enumerate() {
                if let Some(d) = first_difference(v, w, &format!("{path}[{i}]")) {
                    return Some(d);
                }
            }
            (x.len() != y.len()).then(|| format!("{path}: expected {} items, got {}", x.len(), y.len()))
        }
        _ if a == b => None,
        _ => {
            let cut = |v: &Value| v.to_string().chars().take(160).collect::<String>();
            Some(format!("{path}: expected {}, got {}", cut(a), cut(b)))
        }
    }
}

/// Every fixture's name with the problem found, if any.
fn failures(dir: &PathBuf) -> (usize, Vec<String>) {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter_map(|n| n.strip_suffix(".docx").map(String::from))
        .collect();
    names.sort();
    let mut bad = Vec::new();
    for name in &names {
        let bytes = fs::read(dir.join(format!("{name}.docx"))).unwrap();
        let text = fs::read_to_string(dir.join(format!("{name}.json"))).unwrap_or_else(|e| panic!("{name}.json: {e}"));
        let spec: Value = serde_json::from_str(&without_lone_surrogates(&text)).unwrap_or_else(|e| panic!("{name}.json: {e}"));
        let got = import_docx(&bytes, &options(&spec));
        let problem = match (&got, spec.get("error").and_then(Value::as_str)) {
            (Ok(r), None) => first_difference(&spec["result"], &as_json(r), "result"),
            (Err(e), Some(code)) => (e.code.as_str() != code).then(|| format!("expected error {code}, got {}", e.code.as_str())),
            (Ok(_), Some(code)) => Some(format!("expected error {code}, but the import succeeded")),
            (Err(e), None) => Some(format!("expected a result, got error {} ({})", e.code.as_str(), e.message)),
        };
        if let Some(p) = problem {
            bad.push(format!("{name}: {p}"));
        }
    }
    (names.len(), bad)
}

#[test]
fn every_contract_fixture_imports_to_the_expected_output() {
    let dir = fixture_dir();
    let (count, bad) = failures(&dir);
    assert!(count > 0, "no fixtures in {}", dir.display());
    assert!(bad.is_empty(), "{} of {count} fixtures differ:\n{}", bad.len(), bad.join("\n"));
}

#[test]
fn lone_surrogate_escapes_are_removed_but_pairs_and_escaped_backslashes_stay() {
    assert_eq!(without_lone_surrogates(r#""a\ud83d b""#), r#""a b""#);
    assert_eq!(without_lone_surrogates(r#""a\ude00b""#), r#""ab""#);
    assert_eq!(without_lone_surrogates(r#""\ud83d\ude00""#), r#""\ud83d\ude00""#);
    assert_eq!(without_lone_surrogates(r#""\\ud83d \u00e9 \n é""#), r#""\\ud83d \u00e9 \n é""#);
    assert_eq!(without_lone_surrogates(r#""\ud83d\u0041""#), r#""\u0041""#);
    assert_eq!(without_lone_surrogates(r#""\u12""#), r#""\u12""#);
}

#[test]
fn the_difference_finder_names_the_first_difference() {
    let a = json!({"a": [1, {"b": "x"}], "c": 1});
    assert_eq!(first_difference(&a, &a, "r"), None);
    assert_eq!(first_difference(&a, &json!({"a": [1, {"b": "y"}], "c": 1}), "r").as_deref(), Some("r.a[1].b: expected \"x\", got \"y\""));
    assert_eq!(first_difference(&a, &json!({"a": [1], "c": 1}), "r").as_deref(), Some("r.a: expected 2 items, got 1"));
    assert_eq!(first_difference(&a, &json!({"a": [1, {"b": "x"}]}), "r").as_deref(), Some("r.c is only in the expected output"));
    assert_eq!(first_difference(&a, &json!({"a": [1, {"b": "x"}], "c": 1, "d": 2}), "r").as_deref(), Some("r.d is only in the actual output"));
    assert!(first_difference(&json!(1), &json!("1"), "r").is_some());
}

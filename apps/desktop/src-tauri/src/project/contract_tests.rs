//! Runs the shared test vectors in `fixtures/contract/*.json`. The TypeScript twin is
//! `packages/project-fs/test/contract.test.ts`; both must agree so the Rust app and the MCP server follow the same rules.
use super::*;
use serde_json::Value;

fn vectors(name: &str) -> Value {
    let path = format!("{}/../../../fixtures/contract/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))).unwrap()
}

fn hex(h: &str) -> Vec<u8> {
    (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

#[test]
fn contract_safe_paths() {
    let root = Path::new("/p");
    for c in vectors("safe-path")["resolve"].as_array().unwrap() {
        let rel = s(&c["rel"]);
        let got = resolve(root, rel);
        if c["ok"].as_bool().unwrap() {
            assert_eq!(got.unwrap_or_else(|e| panic!("{rel:?}: {e}")), root.join(s(&c["normalized"])), "{rel:?}");
        } else {
            assert!(got.is_err(), "{rel:?} must be refused");
        }
    }
}

#[test]
fn contract_image_references_are_refused() {
    let d = tempfile::tempdir().unwrap();
    let md = d.path().join("book.md");
    for c in vectors("safe-path")["imageReference"]["reject"].as_array().unwrap() {
        let reference = s(&c["reference"]);
        let err = crate::import_src::read_relative_image(&md, reference).unwrap_err();
        assert!(err.contains(s(&c["error"])), "{reference:?}: {err}");
    }
}

#[test]
fn contract_sanitize_names_and_extensions() {
    let v = vectors("sanitize-name");
    for c in v["stems"].as_array().unwrap() {
        assert_eq!(sanitize_asset_stem(s(&c["stem"])), s(&c["expected"]), "{:?}", c["stem"]);
    }
    for c in v["extensions"]["cases"].as_array().unwrap() {
        let want = c["expected"].as_str().map(str::to_string);
        assert_eq!(image_ext(s(&c["name"])), want, "{:?}", c["name"]);
    }
}

#[test]
fn contract_magic_bytes() {
    for c in vectors("magic-bytes")["cases"].as_array().unwrap() {
        assert_eq!(looks_like(s(&c["ext"]), &hex(s(&c["hex"]))), c["expected"].as_bool().unwrap(), "{}", s(&c["name"]));
    }
}

/// Replaces the live `YYYYMMDD-HHMM` stamp after `.conflict-` with the literal `STAMP`.
fn mask_stamp(copy: &str) -> String {
    let i = copy.find(".conflict-").expect("conflict marker") + ".conflict-".len();
    format!("{}STAMP{}", &copy[..i], &copy[i + 13..])
}

#[test]
fn contract_conflict_names() {
    for c in vectors("conflict-name")["names"].as_array().unwrap() {
        let rel = s(&c["rel"]);
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join(rel).parent().unwrap()).unwrap();
        fs::write(d.path().join(rel), "external").unwrap();
        let r = write_file(d.path(), rel, "mine", Some(&"0".repeat(64))).unwrap();
        let copy = mask_stamp(&r.conflict_copy.expect("conflict copy"));
        assert_eq!(fs::read_to_string(d.path().join(rel)).unwrap(), "mine");
        assert_eq!(copy, s(&c["expected"]), "{rel}");
    }
}

#[test]
fn contract_asset_collisions() {
    for seq in vectors("asset-collision")["sequences"].as_array().unwrap() {
        let d = tempfile::tempdir().unwrap();
        let mut seen: std::collections::HashMap<String, String> = Default::default();
        for step in seq["steps"].as_array().unwrap() {
            let name = s(&step["file"]);
            let hex_in = s(&step["hex"]);
            let got = store_image(d.path(), name, &hex(hex_in));
            if let Some(err) = step.get("error") {
                let e = got.unwrap_err();
                assert!(e.contains(s(err)), "{}: {name}: {e}", s(&seq["name"]));
                continue;
            }
            let rel = got.unwrap_or_else(|e| panic!("{}: {name}: {e}", s(&seq["name"])));
            assert_eq!(rel, s(&step["expected"]), "{}: {name}", s(&seq["name"]));
            let first = seen.entry(rel.clone()).or_insert_with(|| hex_in.to_string()).clone();
            assert_eq!(fs::read(d.path().join(&rel)).unwrap(), hex(&first), "{rel} must keep its first content");
        }
        let on_disk = fs::read_dir(d.path().join("assets")).map(|r| r.count()).unwrap_or(0);
        assert_eq!(on_disk, seen.len(), "{}", s(&seq["name"]));
    }
}

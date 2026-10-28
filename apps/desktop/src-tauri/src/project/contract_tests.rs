//! Runs the shared test vectors in `fixtures/contract/*.json`. The TypeScript twin is
//! `packages/project-fs/test/contract.test.ts`; both must agree so the Rust app and the MCP server follow the same rules.
use super::assets::{image_size, looks_like};
use super::trash::parse_trash_name;
use super::*;
use std::{fs, path::Path};
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
        let err = crate::import_src::read_relative_image(&md, reference).unwrap_err().to_string();
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
                let e = got.unwrap_err().to_string();
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

#[cfg(unix)]
#[test]
fn contract_symlink_containment() {
    let v = &vectors("safe-path")["symlinks"];
    let d = tempfile::tempdir().unwrap();
    for f in v["files"].as_array().unwrap() {
        let p = d.path().join(s(f));
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, "x").unwrap();
    }
    for l in v["links"].as_array().unwrap() {
        let at = d.path().join(s(&l["at"]));
        fs::create_dir_all(at.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(d.path().join(s(&l["to"])), at).unwrap();
    }
    let root = d.path().join("project");
    for c in v["cases"].as_array().unwrap() {
        let rel = s(&c["rel"]);
        let got = resolve(&root, rel);
        if c["ok"].as_bool().unwrap() {
            assert!(got.is_ok(), "{rel:?}: {got:?}");
        } else {
            assert!(matches!(got, Err(ProjectError::PathEscape { .. })), "{rel:?} must be refused as an escape: {got:?}");
        }
    }
}

#[test]
fn contract_trash_names() {
    let v = vectors("trash-name");
    for c in v["parse"].as_array().unwrap() {
        let name = s(&c["name"]);
        let got = parse_trash_name(name);
        match c["original"].as_str() {
            Some(orig) => assert_eq!(got, Some((s(&c["trashedAt"]).to_string(), orig.to_string())), "{name}"),
            None => assert_eq!(got, None, "{name}"),
        }
    }
    for rel in v["roundTrip"].as_array().unwrap() {
        let rel = s(rel);
        let d = tempfile::tempdir().unwrap();
        write_file(d.path(), rel, "x", None).unwrap();
        let t = trash_file(d.path(), rel).unwrap();
        let listed = list_trash(d.path()).unwrap();
        assert_eq!(listed.len(), 1, "{rel}");
        assert_eq!(listed[0].original, rel);
        assert_eq!(restore_trash(d.path(), &t).unwrap(), rel);
    }
}

#[test]
fn contract_image_dimensions() {
    let v = vectors("image-dimensions");
    assert_eq!(v["maxPixels"].as_u64().unwrap(), MAX_IMAGE_PIXELS);
    for c in v["cases"].as_array().unwrap() {
        let want = c["expected"].as_array().map(|a| (a[0].as_u64().unwrap(), a[1].as_u64().unwrap()));
        assert_eq!(image_size(s(&c["ext"]), &hex(s(&c["hex"]))), want, "{}", s(&c["name"]));
    }
}

/// The v3, v4 and v5 manifest vectors (`fixtures/contract/manifest-*.json`), also read by `packages/format` tests. Rust does not
/// parse the manifest; it checks that every recorded path passes the same `resolve` rule, the editions are consistent, and
/// the v3 chapter paths are the v4 source paths (the migration moves no file).
#[test]
fn contract_manifest_fixtures() {
    let root = Path::new("/p");
    let v3 = vectors("manifest-v3");
    assert_eq!(v3["formatVersion"], 3);
    let v4 = vectors("manifest-v4");
    assert_eq!(v4["formatVersion"], 4);

    let editions = v4["editions"].as_array().unwrap();
    let langs: Vec<&str> = editions.iter().map(|e| s(&e["language"])).collect();
    assert_eq!(langs[0], "en", "the first edition is the source");
    assert_eq!(langs.len(), langs.iter().collect::<std::collections::HashSet<_>>().len(), "unique languages");

    for section in ["frontMatter", "chapters", "backMatter"] {
        for e in v4[section].as_array().unwrap() {
            for map in ["titles", "files"] {
                for (lang, value) in e[map].as_object().unwrap() {
                    assert!(langs.contains(&lang.as_str()), "{map}.{lang} has no edition");
                    if map == "files" {
                        resolve(root, s(value)).unwrap_or_else(|err| panic!("{lang}: {value}: {err}"));
                    }
                }
            }
            assert!(e["titles"]["en"].is_string() && e["files"]["en"].is_string(), "source title and file");
        }
    }

    let v3_chapter_files: Vec<&str> = v3["chapters"].as_array().unwrap().iter().map(|c| s(&c["file"])).collect();
    let v4_source_files: Vec<&str> = v4["chapters"].as_array().unwrap().iter().map(|c| s(&c["files"]["en"])).collect();
    assert_eq!(v3_chapter_files, v4_source_files, "the migration keeps every source file in place");

    let v5 = vectors("manifest-v5");
    assert_eq!(v5["formatVersion"], 5);
    assert_eq!(v5["chapters"], v4["chapters"], "version 5 only adds references");
    let ids: Vec<&str> = v5["chapters"].as_array().unwrap().iter().map(|c| s(&c["id"])).collect();
    for r in v5["references"].as_array().unwrap() {
        let file = s(&r["file"]);
        assert!(file.starts_with("references/") && !file["references/".len()..].contains('/'), "{file} is flat");
        resolve(root, file).unwrap_or_else(|err| panic!("{file}: {err}"));
        for c in r["chapters"].as_array().unwrap() {
            assert!(ids.contains(&s(c)), "link {c} names a chapter");
        }
    }
}

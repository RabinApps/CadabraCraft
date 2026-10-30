//! Times the app's Rust project layer on a real project folder and prints one JSON object (see scripts/perf/README.md).
//!
//!   perfprobe --root <project> [--copy] [--docx <file>] [--iters N] [--pretty]
//!
//! The code under test is the app's own: `src/project` and `src/import_docx` are compiled into this binary with `#[path]`
//! because `cadabracraft_lib` exports nothing but `run()` (every module is private) and the app crate cannot be built
//! without its sidecar binaries. With `--copy` the project is copied to a temporary folder first (the copy is not timed),
//! so the generated book stays pristine and can be reused.
#![allow(dead_code, unused_imports)]

#[path = "../../../../src/import_docx/mod.rs"]
mod import_docx;
#[path = "../../../../src/project/mod.rs"]
mod project;

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

// ---------------------------------------------------------------- process stats (no libc crate: the two calls are declared by hand)

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Timeval {
    sec: i64,
    #[cfg(target_os = "macos")]
    usec: i32,
    #[cfg(not(target_os = "macos"))]
    usec: i64,
}
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Rusage {
    utime: Timeval,
    stime: Timeval,
    maxrss: i64,
    rest: [i64; 13],
}
extern "C" {
    fn getrusage(who: i32, usage: *mut Rusage) -> i32;
}

fn rusage() -> Rusage {
    let mut r = Rusage::default();
    // SAFETY: `r` is a correctly laid out, writable `struct rusage` for RUSAGE_SELF (0) on macOS and Linux.
    unsafe { getrusage(0, &mut r) };
    r
}

/// User plus system CPU time of this process so far, in milliseconds.
fn cpu_ms() -> f64 {
    let r = rusage();
    let t = |v: Timeval| v.sec as f64 * 1000.0 + v.usec as f64 / 1000.0;
    t(r.utime) + t(r.stime)
}

/// Peak resident set size in KiB: `VmHWM` on Linux, `ru_maxrss` (bytes there) on macOS.
fn peak_rss_kb() -> u64 {
    if cfg!(target_os = "linux") {
        if let Ok(s) = fs::read_to_string("/proc/self/status") {
            if let Some(kb) = s.lines().find_map(|l| l.strip_prefix("VmHWM:")).and_then(|v| v.trim().trim_end_matches("kB").trim().parse().ok()) {
                return kb;
            }
        }
        return rusage().maxrss as u64;
    }
    rusage().maxrss as u64 / 1024
}

// ---------------------------------------------------------------- measurement helpers

/// Runs `f` once and returns (result, wall ms, cpu ms).
fn timed<T>(f: impl FnOnce() -> T) -> (T, f64, f64) {
    let (c0, t0) = (cpu_ms(), Instant::now());
    let v = f();
    (v, t0.elapsed().as_secs_f64() * 1000.0, cpu_ms() - c0)
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((p / 100.0 * sorted.len() as f64) as usize).min(sorted.len() - 1)]
}

fn round(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// A step that is one call: wall and CPU milliseconds.
fn once<T>(steps: &mut serde_json::Map<String, Value>, name: &str, f: impl FnOnce() -> T) -> T {
    let (v, wall, cpu) = timed(f);
    steps.insert(name.into(), json!({ "wall_ms": round(wall), "cpu_ms": round(cpu) }));
    v
}

/// A step repeated over many items: total, per-item median / p95 / max (wall ms) and total CPU.
fn each<I, T>(steps: &mut serde_json::Map<String, Value>, name: &str, items: impl IntoIterator<Item = I>, mut f: impl FnMut(I) -> T) {
    let (mut walls, c0, t0) = (vec![], cpu_ms(), Instant::now());
    for it in items {
        let t = Instant::now();
        f(it);
        walls.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let total = t0.elapsed().as_secs_f64() * 1000.0;
    walls.sort_by(|a, b| a.partial_cmp(b).unwrap());
    steps.insert(
        name.into(),
        json!({ "n": walls.len(), "wall_ms": round(total), "cpu_ms": round(cpu_ms() - c0), "p50_ms": round(pct(&walls, 50.0)), "p95_ms": round(pct(&walls, 95.0)), "max_ms": round(walls.last().copied().unwrap_or(0.0)) }),
    );
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap().flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_type().unwrap().is_dir() {
            copy_dir(&src, &dst);
        } else {
            fs::copy(&src, &dst).unwrap();
        }
    }
}

/// Every file under `dir`, as project-relative paths (what the file watcher and a project listing walk).
fn list_files(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            list_files(root, &p, out);
        } else if let Ok(rel) = p.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn die(msg: &str) -> ! {
    eprintln!("perfprobe: {msg}");
    std::process::exit(2)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |n: &str| args.iter().position(|a| a == n).and_then(|i| args.get(i + 1)).cloned();
    let src = PathBuf::from(get("--root").unwrap_or_else(|| die("usage: perfprobe --root <project> [--copy] [--docx <file>] [--iters N] [--pretty]")));
    let iters: usize = get("--iters").map_or(3, |v| v.parse().unwrap_or_else(|_| die("--iters needs a number")));
    let docx = get("--docx").map(PathBuf::from);
    let _keep; // keeps the temporary copy alive
    let root = if args.iter().any(|a| a == "--copy") {
        let d = tempfile::tempdir().unwrap();
        copy_dir(&src, d.path());
        let p = d.path().to_path_buf();
        _keep = d;
        p
    } else {
        src.clone()
    };
    let root = fs::canonicalize(&root).unwrap_or_else(|e| die(&format!("{}: {e}", root.display())));
    let mut steps = serde_json::Map::new();
    let start_cpu = cpu_ms();

    // Open: validate the folder, read and parse the manifest, walk the folder.
    let manifest_text = once(&mut steps, "open_project", || {
        project::require_project(&root).unwrap_or_else(|e| die(&format!("not a project: {e:?}")));
        project::read_file(&root, "cadabra.json").unwrap().unwrap_or_else(|| die("no manifest")).contents
    });
    let manifest: Value = serde_json::from_str(&manifest_text).unwrap_or_else(|e| die(&format!("manifest is not JSON: {e}")));
    let mut files = vec![];
    once(&mut steps, "list_project_files", || list_files(&root, &root, &mut files));
    let pages: Vec<String> = ["frontMatter", "chapters", "backMatter"]
        .iter()
        .flat_map(|k| manifest[k].as_array().cloned().unwrap_or_default())
        .filter_map(|e| e["files"].as_object().and_then(|f| f.values().next()).and_then(|v| v.as_str()).map(String::from))
        .collect();

    // Chapter reads: every page, each read hashed (read_file returns the text and its hash).
    let mut hashes = std::collections::HashMap::new();
    let mut bytes_total = 0usize;
    each(&mut steps, "read_pages", pages.iter(), |p| {
        let r = project::read_file(&root, p).unwrap().unwrap_or_else(|| die(&format!("missing page {p}")));
        bytes_total += r.contents.len();
        hashes.insert(p.clone(), r.hash);
    });
    // The largest page, read and written `iters` more times (the editor's autosave of a very long chapter).
    let biggest = pages.iter().max_by_key(|p| fs::metadata(root.join(p)).map_or(0, |m| m.len())).cloned();
    if let Some(big) = &biggest {
        let size = fs::metadata(root.join(big)).map_or(0, |m| m.len());
        steps.insert("largest_page_bytes".into(), json!(size));
        each(&mut steps, "read_largest_page", 0..iters, |_| {
            project::read_file(&root, big).unwrap();
        });
        let text = project::read_file(&root, big).unwrap().unwrap().contents;
        let mut hash = hashes[big].clone();
        each(&mut steps, "write_largest_page_base_hash", 0..iters, |_| {
            hash = project::write_file(&root, big, &text, Some(&hash)).unwrap().hash;
        });
    }
    // Every page written back with its base hash (the first save of a session also keeps a snapshot, the throttle then skips).
    each(&mut steps, "write_pages_first_save", pages.iter(), |p| {
        let text = project::read_file(&root, p).unwrap().unwrap().contents;
        project::write_file(&root, p, &text, hashes.get(p).map(String::as_str)).unwrap();
    });
    each(&mut steps, "write_pages_throttled", pages.iter(), |p| {
        let r = project::read_file(&root, p).unwrap().unwrap();
        project::write_file(&root, p, &r.contents, Some(&r.hash)).unwrap();
    });
    // A raw atomic write (temp file, fsync, rename) of 64 KiB and 8 MiB.
    for (name, size) in [("atomic_write_64k", 64 * 1024), ("atomic_write_8m", 8 * 1024 * 1024)] {
        let buf = vec![b'x'; size];
        let target = root.join(format!(".cadabra/perf-{name}.tmpdata"));
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        each(&mut steps, name, 0..iters, |_| project::atomic_write(&target, &buf).unwrap());
        let _ = fs::remove_file(&target);
    }

    // Snapshots: a whole-book snapshot, the listing, and one page's history.
    let now = chrono::Utc::now();
    let snap = once(&mut steps, "book_snapshot_create", || project::book_snapshots::create_book_snapshot(&root, "perfprobe", now).unwrap());
    steps.insert("book_snapshot_bytes".into(), json!(snap.bytes));
    let listed = once(&mut steps, "book_snapshot_list", || project::book_snapshots::list_book_snapshots(&root).unwrap());
    steps.insert("book_snapshot_count".into(), json!(listed.len()));
    if let Some(first) = pages.first() {
        let kept = once(&mut steps, "page_snapshot_list", || project::snapshots::list_snapshots(&root, first).unwrap());
        steps.insert("page_snapshot_count".into(), json!(kept.len()));
        if let Some(s) = kept.first() {
            once(&mut steps, "page_snapshot_read", || project::snapshots::read_snapshot(&root, first, &s.path).unwrap());
        }
        once(&mut steps, "book_snapshot_read_page", || project::book_snapshots::read_book_snapshot_page(&root, &snap.path, first).unwrap());
    }

    // Images and references.
    let images: Vec<&String> = files.iter().filter(|f| f.starts_with("assets/")).collect();
    each(&mut steps, "read_assets", images.iter(), |p| {
        project::read_asset(&root, p).unwrap();
    });
    if let Some(img) = images.first() {
        let bytes = project::read_asset(&root, img).unwrap();
        // Same bytes under a new name: hashed, checked, written (the import path of a pasted image).
        let mut changed = bytes.clone();
        if let Some(b) = changed.last_mut() {
            *b ^= 1; // keeps the PNG signature and size, the CRC no longer matches (the app does not decode)
        }
        once(&mut steps, "store_image", || project::store_image(&root, "perfprobe-image.png", &changed).unwrap());
    }
    let refs: Vec<&String> = files.iter().filter(|f| f.starts_with("references/")).collect();
    each(&mut steps, "stat_references", refs.iter(), |p| {
        project::stat_reference(&root, p).unwrap();
    });
    each(&mut steps, "read_reference_range", refs.iter(), |p| {
        project::read_reference_range(&root, p, 0, 64 * 1024).unwrap();
    });

    // Optional: import a .docx (archive, XML, body walk, chapter split) held in memory.
    if let Some(d) = &docx {
        let bytes = fs::read(d).unwrap_or_else(|e| die(&format!("{}: {e}", d.display())));
        steps.insert("docx_bytes".into(), json!(bytes.len()));
        let r = once(&mut steps, "import_docx", || import_docx::import_docx(&bytes, &import_docx::Options::default()));
        steps.insert("import_docx_chapters".into(), json!(r.as_ref().map_or(0, |x| x.chapters.len())));
        steps.insert("import_docx_error".into(), json!(r.err().map(|e| format!("{e:?}"))));
    }

    let out = json!({
        "tool": "perfprobe",
        "os": std::env::consts::OS,
        "pages": pages.len(),
        "page_bytes": bytes_total,
        "files": files.len(),
        "iters": iters,
        "steps": Value::Object(steps),
        "cpu_ms": round(cpu_ms() - start_cpu),
        "peak_rss_kb": peak_rss_kb(),
    });
    println!("{}", if args.iter().any(|a| a == "--pretty") { serde_json::to_string_pretty(&out).unwrap() } else { out.to_string() });
}

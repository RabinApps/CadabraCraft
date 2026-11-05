//! Generates huge, deterministic CadabraCraft projects (and .docx files) for performance and fuzz work. Std only.
//!
//!   cargo run --release --example bookgen -- --out /tmp/book --preset huge
//!   cargo run --release --example bookgen -- --out /tmp/book --chapters 40 --words-per-chapter 2500 \
//!       --images 10 --image-kb 64 --references 5 --snapshots 2 --seed 7
//!   cargo run --release --example bookgen -- --docx /tmp/big.docx --paragraphs 200000
//!   cargo run --release --example bookgen -- --docx-bomb node --docx /tmp/node-bomb.docx [--bomb-depth 100000]
//!   cargo run --release --example bookgen -- --docx-bomb zip  --docx /tmp/zip-bomb.docx  [--bomb-mb 190]
//!
//! Project mode writes the exact on-disk format of the app (formatVersion 6 manifest, `manuscript/NNN-slug.json` TipTap
//! documents, `assets/*.png`, `references/*`, `.cadabra/snapshots/*.json` whole-book snapshots). The text model mirrors
//! `apps/desktop/src/test/bigBook.ts`: headings, dialogue, bold and italic marks, footnotes and scene breaks.
//! Presets: `huge` (500 chapters), `giant-chapter` (one 200k-word chapter), `media` (many images and references),
//! `small` (smoke test). Explicit flags override a preset.

use binary::*;
use docx::*;
use std::fs;
use std::path::{Path, PathBuf};
use text::*;

mod binary;
mod docx;
mod text;

// ---------------------------------------------------------------- project

struct Opts {
    out: Option<PathBuf>,
    chapters: usize,
    words: usize,
    images: usize,
    image_kb: usize,
    references: usize,
    reference_kb: usize,
    snapshots: usize,
    seed: u32,
    docx: Option<PathBuf>,
    paragraphs: usize,
    bomb: Option<String>,
    bomb_depth: usize,
    bomb_mb: u64,
}

fn parse_args() -> Opts {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let get = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let num = |name: &str, d: usize| get(name).map_or(d, |v| v.replace('_', "").parse().unwrap_or_else(|_| die(&format!("{name} needs a number"))));
    // preset: (chapters, words per chapter, images, image kb, references, snapshots)
    let preset = match get("--preset").as_deref() {
        None => (40, 2500, 0, 64, 0, 0),
        Some("small") => (5, 500, 2, 8, 2, 1),
        Some("huge") => (500, 400, 20, 64, 50, 3),
        Some("giant-chapter") => (1, 200_000, 0, 64, 0, 1),
        Some("media") => (40, 2500, 300, 256, 200, 2),
        Some(p) => die(&format!("unknown preset {p} (small, huge, giant-chapter, media)")),
    };
    Opts {
        out: get("--out").map(PathBuf::from),
        chapters: num("--chapters", preset.0),
        words: num("--words-per-chapter", preset.1),
        images: num("--images", preset.2),
        image_kb: num("--image-kb", preset.3),
        references: num("--references", preset.4),
        reference_kb: num("--reference-kb", 16),
        snapshots: num("--snapshots", preset.5),
        seed: num("--seed", 1) as u32,
        docx: get("--docx").map(PathBuf::from),
        paragraphs: num("--paragraphs", 10_000),
        bomb: get("--docx-bomb"),
        bomb_depth: num("--bomb-depth", 100_000),
        bomb_mb: num("--bomb-mb", 190) as u64,
    }
}

fn die(msg: &str) -> ! {
    eprintln!("bookgen: {msg}");
    std::process::exit(2)
}

fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap_or_else(|e| die(&format!("cannot write {}: {e}", path.display())));
}

fn slug(title: &str) -> String {
    title.to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect::<String>().trim_matches('-').to_string()
}

/// 2026-01-01T00:00:00Z minus `minutes_ago`, so the output is deterministic.
fn iso(minutes_ago: u64) -> String {
    let t = 1_767_225_600u64 - minutes_ago * 60;
    let (days, secs) = (t / 86400, t % 86400);
    let (y, m, d) = civil(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, secs % 3600 / 60, secs % 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    ((yoe + era * 400) + i64::from(m <= 2), m, d)
}

fn write_project(o: &Opts, out: &Path) {
    if out.join("cadabra.json").exists() {
        die(&format!("{} already holds a project; choose an empty folder", out.display()));
    }
    for d in ["manuscript", "front-matter", "back-matter", "assets", "references", "exports", ".cadabra"] {
        fs::create_dir_all(out.join(d)).unwrap();
    }
    let mut rng = Rng(o.seed ^ 0x9e37_79b9);
    let image_paths: Vec<String> = (1..=o.images).map(|i| format!("assets/img-{i}.png")).collect();
    for p in &image_paths {
        write(&out.join(p), &png(o.image_kb, &mut rng));
    }
    // Weighted chapter sizes, uneven like a real manuscript (same scheme as bigBook()).
    let weights: Vec<f64> = (0..o.chapters).map(|_| 0.5 + rng.next()).collect();
    let total: f64 = weights.iter().sum();
    let (mut entries, mut pages) = (vec![], vec![]);
    for i in 0..o.chapters {
        let title = format!("Chapter {}", i + 1);
        let words = if o.chapters == 1 { o.words } else { ((weights[i] / total) * (o.words * o.chapters) as f64).round() as usize };
        let mine: Vec<String> = image_paths.iter().enumerate().filter(|(k, _)| k % o.chapters == i).map(|(_, p)| p.clone()).collect();
        let file = format!("manuscript/{:03}-{}.json", i + 1, slug(&title));
        let doc = chapter_doc(words, o.seed.wrapping_mul(1000).wrapping_add(i as u32), &title, &mine);
        write(&out.join(&file), doc.as_bytes());
        entries.push(format!("{{\"id\":\"ch-{0}\",\"titles\":{{\"en\":\"{1}\"}},\"files\":{{\"en\":\"{2}\"}}}}", i + 1, esc(&title), esc(&file)));
        pages.push((file, doc));
    }
    let mut refs = vec![];
    let words: Vec<&str> = WORDS.split(' ').collect();
    for i in 1..=o.references {
        let file = format!("references/ref-{i}.txt");
        let mut body = String::new();
        while body.len() < o.reference_kb * 1024 {
            body.push_str(&sentence(&mut rng, &words));
            body.push(' ');
        }
        write(&out.join(&file), body.as_bytes());
        let link = if o.chapters > 0 { format!("\"ch-{}\"", 1 + (i - 1) % o.chapters) } else { String::new() };
        refs.push(format!(
            "{{\"id\":\"ref-{i}\",\"file\":\"{file}\",\"title\":\"Reference {i}\",\"note\":\"Research note {i}.\",\"tags\":[\"research\"],\"chapters\":[{link}],\"addedAt\":\"{}\"}}",
            iso(i as u64)
        ));
    }
    let manifest = format!(
        "{{\n  \"formatVersion\": 6,\n  \"editions\": [{{\"language\":\"en\",\"title\":\"Generated Book (seed {})\",\"author\":\"bookgen\",\"identifier\":\"urn:uuid:00000000-0000-4000-8000-{:012}\",\"isbn\":null,\"cover\":null}}],\n  \"template\": \"novel\",\n  \"frontMatter\": [],\n  \"chapters\": [{}],\n  \"backMatter\": [],\n  \"references\": [{}]\n}}\n",
        o.seed,
        o.seed,
        entries.join(",\n    "),
        refs.join(",\n    ")
    );
    write(&out.join("cadabra.json"), manifest.as_bytes());
    // Whole-book snapshots: `.cadabra/snapshots/<YYYYMMDD-HHMM>.json`, one per hour going back from a fixed anchor.
    for m in 0..o.snapshots {
        let t = iso(60 * (m as u64 + 1)).replace(['-', ':'], "");
        let stamp = format!("{}-{}", &t[..8], &t[9..13]);
        let page_map: Vec<String> = pages.iter().map(|(f, d)| format!("\"{}\":\"{}\"", esc(f), esc(d))).collect();
        let assets: Vec<String> = image_paths.iter().map(|p| format!("\"{p}\"")).collect();
        let body = format!(
            "{{\"version\":1,\"name\":\"Generated snapshot {}\",\"automatic\":false,\"manifest\":\"{}\",\"pages\":{{{}}},\"assets\":[{}]}}",
            m + 1,
            esc(&manifest),
            page_map.join(","),
            assets.join(",")
        );
        write(&out.join(format!(".cadabra/snapshots/{stamp}.json")), body.as_bytes());
    }
    let bytes = walk(out);
    eprintln!("wrote {} chapters, {} images, {} references, {} snapshots to {} ({:.1} MiB)", o.chapters, o.images, o.references, o.snapshots, out.display(), bytes as f64 / 1_048_576.0);
}

fn walk(dir: &Path) -> u64 {
    fs::read_dir(dir).map_or(0, |rd| rd.flatten().map(|e| if e.path().is_dir() { walk(&e.path()) } else { e.metadata().map_or(0, |m| m.len()) }).sum())
}

fn main() {
    let o = parse_args();
    if let Some(kind) = &o.bomb {
        let path = o.docx.clone().unwrap_or_else(|| die("--docx-bomb needs --docx <path>"));
        match kind.as_str() {
            "node" => write_docx(&path, &node_bomb(o.bomb_depth)),
            "zip" => write_zip_bomb(&path, o.bomb_mb),
            k => die(&format!("unknown bomb {k} (node, zip)")),
        }
        eprintln!("wrote {}", path.display());
    } else if let Some(path) = &o.docx {
        write_docx(path, &document_xml(o.paragraphs, o.seed));
        eprintln!("wrote {} ({} paragraphs)", path.display(), o.paragraphs);
    } else if let Some(out) = &o.out {
        write_project(&o, out);
    } else {
        die("usage: bookgen --out <dir> [--preset huge|giant-chapter|media|small] [--chapters N --words-per-chapter W --images K --image-kb S --references R --snapshots M --seed X] | --docx <file> [--paragraphs N] | --docx-bomb node|zip --docx <file>");
    }
}

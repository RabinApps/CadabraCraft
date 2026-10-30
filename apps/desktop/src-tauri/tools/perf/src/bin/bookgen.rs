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
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------- PRNG and text

/// mulberry32, the same generator as `bigBook.ts`.
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize
    }
}

const WORDS: &str = "the of and to a in that he she it was for on with as his her at by from they had but not said you one all would there their what out up about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us night door hand eyes face stood walked turned silence light rain window road house long dark quiet moment heart voice remember never always something nothing together lost found morning evening garden river stone letter shadow whisper";
const NAMES: [&str; 6] = ["Mara", "Idris", "Colm", "Perrin", "Odile", "Tamsin"];

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o
}

fn sentence(r: &mut Rng, words: &[&str]) -> String {
    let n = 6 + (r.next() * 14.0) as usize;
    let mut out = String::new();
    for i in 0..n {
        let w = words[r.below(words.len())];
        if i == 0 {
            let mut cs = w.chars();
            out.extend(cs.next().unwrap().to_uppercase());
            out.push_str(cs.as_str());
        } else {
            out.push(' ');
            out.push_str(w);
        }
    }
    out.push(if r.next() < 0.15 { '?' } else { '.' });
    out
}

fn text_node(s: &str, mark: Option<&str>) -> String {
    match mark {
        Some(m) => format!("{{\"type\":\"text\",\"text\":\"{}\",\"marks\":[{{\"type\":\"{m}\"}}]}}", esc(s)),
        None => format!("{{\"type\":\"text\",\"text\":\"{}\"}}", esc(s)),
    }
}

fn count_words(s: &str) -> usize {
    s.split_whitespace().count()
}

/// One paragraph node JSON and its word count (footnote text counts like bigBook.ts: it is part of the tree).
fn paragraph(r: &mut Rng, words: &[&str]) -> (String, usize) {
    let mut parts: Vec<String> = vec![];
    let mut n = 0;
    if r.next() < 0.3 {
        let s = format!("\u{201c}{}\u{201d} {} said. ", sentence(r, words), NAMES[r.below(NAMES.len())]);
        n += count_words(&s);
        parts.push(text_node(&s, None));
    }
    let k = 2 + (r.next() * 4.0) as usize;
    for _ in 0..k {
        let s = format!("{} ", sentence(r, words));
        n += count_words(&s);
        if r.next() < 0.06 {
            let m = if r.next() < 0.5 { "italic" } else { "bold" };
            parts.push(text_node(&s, Some(m)));
        } else {
            parts.push(text_node(&s, None));
        }
        if r.next() < 0.01 {
            let f = sentence(r, words);
            n += count_words(&f);
            parts.push(format!("{{\"type\":\"footnote\",\"content\":[{}]}}", text_node(&f, None)));
        }
    }
    (format!("{{\"type\":\"paragraph\",\"content\":[{}]}}", parts.join(",")), n)
}

/// A chapter document of about `words` words. `images` lists the asset paths to place in it, spread evenly.
fn chapter_doc(words_target: usize, seed: u32, title: &str, images: &[String]) -> String {
    let words: Vec<&str> = WORDS.split(' ').collect();
    let mut r = Rng(seed);
    let mut blocks = vec![format!("{{\"type\":\"heading\",\"attrs\":{{\"level\":1}},\"content\":[{}]}}", text_node(title, None))];
    let mut n = 0;
    let mut placed = 0;
    while n < words_target {
        let x = r.next();
        if x < 0.01 {
            let s = sentence(&mut r, &words);
            blocks.push(format!("{{\"type\":\"heading\",\"attrs\":{{\"level\":2}},\"content\":[{}]}}", text_node(&s[..s.len() - 1], None)));
        } else if x < 0.03 {
            blocks.push("{\"type\":\"sceneBreak\"}".into());
        } else {
            let (p, k) = paragraph(&mut r, &words);
            blocks.push(p);
            n += k;
        }
        // Place the next image once the chapter has passed its share of words.
        if placed < images.len() && n * images.len() >= (placed + 1) * words_target {
            blocks.push(format!("{{\"type\":\"image\",\"attrs\":{{\"src\":\"{}\",\"alt\":\"Illustration {}\",\"title\":null}}}}", images[placed], placed + 1));
            placed += 1;
        }
    }
    while placed < images.len() {
        blocks.push(format!("{{\"type\":\"image\",\"attrs\":{{\"src\":\"{}\",\"alt\":\"Illustration {}\",\"title\":null}}}}", images[placed], placed + 1));
        placed += 1;
    }
    format!("{{\"type\":\"doc\",\"content\":[{}]}}\n", blocks.join(","))
}

// ---------------------------------------------------------------- checksums, PNG, zip

fn crc_table() -> [u32; 256] {
    let mut t = [0u32; 256];
    for (i, slot) in t.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xedb88320 ^ (c >> 1) } else { c >> 1 };
        }
        *slot = c;
    }
    t
}

struct Crc {
    table: [u32; 256],
    state: u32,
}
impl Crc {
    fn new() -> Crc {
        Crc { table: crc_table(), state: 0xffff_ffff }
    }
    fn update(&mut self, b: &[u8]) {
        for &x in b {
            self.state = self.table[((self.state ^ u32::from(x)) & 0xff) as usize] ^ (self.state >> 8);
        }
    }
    fn finish(&self) -> u32 {
        !self.state
    }
}

fn crc32(b: &[u8]) -> u32 {
    let mut c = Crc::new();
    c.update(b);
    c.finish()
}

fn adler32(b: &[u8]) -> u32 {
    let (mut a, mut s) = (1u32, 0u32);
    for &x in b {
        a = (a + u32::from(x)) % 65521;
        s = (s + a) % 65521;
    }
    (s << 16) | a
}

fn png_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend((data.len() as u32).to_be_bytes());
    let mut body = kind.to_vec();
    body.extend(data);
    out.extend(&body);
    out.extend(crc32(&body).to_be_bytes());
}

/// A valid 8-bit grayscale PNG of about `kb` KiB (noise, stored deflate blocks, so it does not compress).
fn png(kb: usize, rng: &mut Rng) -> Vec<u8> {
    let w = 256usize;
    let h = (kb * 1024 / (w + 1)).max(1);
    let mut raw = Vec::with_capacity(h * (w + 1));
    for _ in 0..h {
        raw.push(0);
        for _ in 0..w {
            raw.push((rng.next() * 256.0) as u8);
        }
    }
    let mut z = vec![0x78, 0x01];
    let mut chunks = raw.chunks(65535).peekable();
    while let Some(c) = chunks.next() {
        z.push(u8::from(chunks.peek().is_none()));
        z.extend((c.len() as u16).to_le_bytes());
        z.extend((!(c.len() as u16)).to_le_bytes());
        z.extend(c);
    }
    z.extend(adler32(&raw).to_be_bytes());
    let mut ihdr = vec![];
    ihdr.extend((w as u32).to_be_bytes());
    ihdr.extend((h as u32).to_be_bytes());
    ihdr.extend([8, 0, 0, 0, 0]);
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png_chunk(&mut out, b"IHDR", &ihdr);
    png_chunk(&mut out, b"IDAT", &z);
    png_chunk(&mut out, b"IEND", &[]);
    out
}

struct Entry {
    name: String,
    method: u16,
    crc: u32,
    csize: u64,
    usize: u64,
    offset: u64,
}

/// A small streaming zip writer (no zip64, so every entry and the archive stay under 4 GiB).
struct Zip<W: Write> {
    w: W,
    at: u64,
    entries: Vec<Entry>,
}
impl<W: Write> Zip<W> {
    fn new(w: W) -> Zip<W> {
        Zip { w, at: 0, entries: vec![] }
    }
    fn put(&mut self, b: &[u8]) {
        self.w.write_all(b).unwrap();
        self.at += b.len() as u64;
    }
    /// A local header with the known sizes, then the bytes `data` writes (exactly `csize` of them).
    fn entry(&mut self, name: &str, method: u16, crc: u32, csize: u64, usize: u64, data: &mut dyn FnMut(&mut dyn FnMut(&[u8]))) {
        let offset = self.at;
        let mut h = vec![];
        h.extend(0x04034b50u32.to_le_bytes());
        h.extend([20, 0, 0, 0]);
        h.extend(method.to_le_bytes());
        h.extend([0, 0, 0x21, 0]); // time 0, date 1980-01-01
        h.extend(crc.to_le_bytes());
        h.extend((csize as u32).to_le_bytes());
        h.extend((usize as u32).to_le_bytes());
        h.extend((name.len() as u16).to_le_bytes());
        h.extend([0, 0]);
        h.extend(name.as_bytes());
        self.put(&h);
        let before = self.at;
        data(&mut |b| self.put(b));
        assert_eq!(self.at - before, csize, "entry {name} wrote the wrong number of bytes");
        self.entries.push(Entry { name: name.into(), method, crc, csize, usize, offset });
    }
    fn stored(&mut self, name: &str, bytes: &[u8]) {
        self.entry(name, 0, crc32(bytes), bytes.len() as u64, bytes.len() as u64, &mut |put| put(bytes));
    }
    fn finish(mut self) {
        let start = self.at;
        let mut cd = vec![];
        for e in &self.entries {
            cd.extend(0x02014b50u32.to_le_bytes());
            cd.extend([20, 0, 20, 0, 0, 0]);
            cd.extend(e.method.to_le_bytes());
            cd.extend([0, 0, 0x21, 0]);
            cd.extend(e.crc.to_le_bytes());
            cd.extend((e.csize as u32).to_le_bytes());
            cd.extend((e.usize as u32).to_le_bytes());
            cd.extend((e.name.len() as u16).to_le_bytes());
            cd.extend([0u8; 12]);
            cd.extend((e.offset as u32).to_le_bytes());
            cd.extend(e.name.as_bytes());
        }
        let count = self.entries.len() as u16;
        self.put(&cd);
        let mut end = vec![];
        end.extend(0x06054b50u32.to_le_bytes());
        end.extend([0, 0, 0, 0]);
        end.extend(count.to_le_bytes());
        end.extend(count.to_le_bytes());
        end.extend((cd.len() as u32).to_le_bytes());
        end.extend((start as u32).to_le_bytes());
        end.extend([0, 0]);
        self.put(&end);
        self.w.flush().unwrap();
    }
}

// ---------------------------------------------------------------- deflate (just enough for a high-ratio bomb)

/// LSB-first bit packer for a deflate stream with one fixed-Huffman block.
struct Bits {
    out: Vec<u8>,
    acc: u32,
    n: u32,
}
impl Bits {
    fn bits(&mut self, v: u32, n: u32) {
        self.acc |= v << self.n;
        self.n += n;
        while self.n >= 8 {
            self.out.push(self.acc as u8);
            self.acc >>= 8;
            self.n -= 8;
        }
    }
    /// Huffman codes are packed most significant bit first.
    fn code(&mut self, code: u32, n: u32) {
        let mut r = 0;
        for i in 0..n {
            r |= ((code >> i) & 1) << (n - 1 - i);
        }
        self.bits(r, n);
    }
    fn literal(&mut self, b: u8) {
        if b < 144 {
            self.code(0x30 + u32::from(b), 8);
        } else {
            self.code(0x190 + u32::from(b) - 144, 9);
        }
    }
    /// A match of length 258 (symbol 285) at distance 1.
    fn run258(&mut self) {
        self.code(0xc0 + (285 - 280), 8);
        self.code(0, 5);
    }
    fn finish(mut self) -> Vec<u8> {
        self.code(0, 7); // end of block (symbol 256)
        if self.n > 0 {
            self.out.push(self.acc as u8);
        }
        self.out
    }
}

/// A deflate stream for `prefix`, then `1 + 258 * runs` spaces, then `suffix`. About 13 bits per 258 bytes (160:1).
fn deflate_spaces(prefix: &[u8], runs: u64, suffix: &[u8]) -> Vec<u8> {
    let mut b = Bits { out: vec![], acc: 0, n: 0 };
    b.bits(1, 1); // last block
    b.bits(1, 2); // fixed Huffman
    for &x in prefix {
        b.literal(x);
    }
    b.literal(b' ');
    for _ in 0..runs {
        b.run258();
    }
    for &x in suffix {
        b.literal(x);
    }
    b.finish()
}

// ---------------------------------------------------------------- .docx

const CONTENT_TYPES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>";
const RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";
const DOC_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>";
const STYLES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/></w:style><w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/></w:style></w:styles>";
const DOC_OPEN: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>";
const DOC_CLOSE: &str = "</w:body></w:document>";

fn xml_esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// document.xml with `paragraphs` paragraphs: a Heading 1 every 150 paragraphs, otherwise prose with some bold and italic runs.
fn document_xml(paragraphs: usize, seed: u32) -> String {
    let words: Vec<&str> = WORDS.split(' ').collect();
    let mut r = Rng(seed);
    let mut o = String::from(DOC_OPEN);
    for i in 0..paragraphs {
        if i % 150 == 0 {
            o.push_str(&format!("<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Chapter {}</w:t></w:r></w:p>", i / 150 + 1));
            continue;
        }
        o.push_str("<w:p>");
        for _ in 0..(2 + r.below(3)) {
            let s = xml_esc(&format!("{} ", sentence(&mut r, &words)));
            let x = r.next();
            let rpr = if x < 0.06 {
                "<w:rPr><w:b/></w:rPr>"
            } else if x < 0.12 {
                "<w:rPr><w:i/></w:rPr>"
            } else {
                ""
            };
            o.push_str(&format!("<w:r>{rpr}<w:t xml:space=\"preserve\">{s}</w:t></w:r>"));
        }
        o.push_str("</w:p>");
    }
    o.push_str(DOC_CLOSE);
    o
}

fn write_docx(path: &Path, document: &str) {
    let mut z = Zip::new(std::io::BufWriter::new(fs::File::create(path).unwrap()));
    z.stored("[Content_Types].xml", CONTENT_TYPES.as_bytes());
    z.stored("_rels/.rels", RELS.as_bytes());
    z.stored("word/_rels/document.xml.rels", DOC_RELS.as_bytes());
    z.stored("word/styles.xml", STYLES.as_bytes());
    z.stored("word/document.xml", document.as_bytes());
    z.finish();
}

/// Nested `<w:sdt><w:sdtContent>` pairs `depth` deep (the importer refuses more than 101 open elements), then a paragraph.
fn node_bomb(depth: usize) -> String {
    let mut o = String::from(DOC_OPEN);
    for _ in 0..depth {
        o.push_str("<w:sdt><w:sdtContent>");
    }
    o.push_str("<w:p><w:r><w:t>bottom</w:t></w:r></w:p>");
    for _ in 0..depth {
        o.push_str("</w:sdtContent></w:sdt>");
    }
    o.push_str(DOC_CLOSE);
    o
}

/// A deflated document.xml that is `mb` MiB of whitespace inside valid XML: tiny on disk, large in memory. The importer's
/// default cap is 200 MB; use a value above it to see the declared-size refusal, below it to see the inflate path.
fn write_zip_bomb(path: &Path, mb: u64) {
    let runs = (mb * 1024 * 1024).saturating_sub(1) / 258;
    let spaces = 1 + 258 * runs;
    let (prefix, suffix) = (format!("{DOC_OPEN}<w:p><w:r><w:t>"), format!("</w:t></w:r></w:p>{DOC_CLOSE}"));
    let mut crc = Crc::new();
    crc.update(prefix.as_bytes());
    let block = [b' '; 65536];
    let mut left = spaces;
    while left > 0 {
        let n = left.min(block.len() as u64) as usize;
        crc.update(&block[..n]);
        left -= n as u64;
    }
    crc.update(suffix.as_bytes());
    let stream = deflate_spaces(prefix.as_bytes(), runs, suffix.as_bytes());
    let usize = prefix.len() as u64 + spaces + suffix.len() as u64;
    let mut z = Zip::new(std::io::BufWriter::new(fs::File::create(path).unwrap()));
    z.stored("[Content_Types].xml", CONTENT_TYPES.as_bytes());
    z.stored("_rels/.rels", RELS.as_bytes());
    z.entry("word/document.xml", 8, crc.finish(), stream.len() as u64, usize, &mut |put| put(&stream));
    z.finish();
    eprintln!("zip bomb: {} bytes on disk, {} bytes declared", stream.len(), usize);
}

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

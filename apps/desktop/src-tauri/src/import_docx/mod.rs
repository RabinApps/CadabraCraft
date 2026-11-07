//! `.docx` import in Rust: the same job, with the same output, as `packages/import-docx` (the TypeScript importer).
//!
//! The app calls this through the `import_docx` command, so a large manuscript is unzipped and parsed on the blocking pool
//! instead of in the webview. The TypeScript importer stays for the MCP server and headless use (plain Node, no
//! Rust), and the two are held together by the contract fixtures in `fixtures/docx` (`docs/import.md`, "Two importers"):
//! each fixture is a `.docx` plus the JSON the importer must produce, and both test suites run every one.
//!
//! Module map: `archive` (zip with limits), `xml` (the tree), `parts` (relationships, styles, numbering, notes),
//! `body` (paragraphs, lists, tables), `runs` and `drawings` (inline content), `blocks` and `text` (shared builders),
//! `frame` (the binary reply to the webview).
pub mod archive;
pub mod assets;
mod blocks;
mod body;
mod ctx;
mod drawings;
pub mod error;
pub mod frame;
mod lists;
pub mod node;
mod parts;
mod runs;
mod text;
pub mod warnings;
pub mod xml;

use archive::{read_archive, Files, Limits};
use assets::Asset;
use blocks::split_chapters;
pub use blocks::Chapter;
use body::BodyBuilder;
use ctx::DCtx;
pub use error::{ImportError, ImportErrorCode};
use parts::{collect_notes, is_document_target, parse_numbering, parse_rels, parse_styles};
use std::collections::HashMap;
use text::{js_min, js_trim};
use warnings::{Severity, Warning, Warnings};
use xml::{child, children_named, find_root, kids, parse_xml_in, raw_text, XNode, XmlBudget, XmlLimits};

/// The options of `ImportOptions` in `packages/import-docx` that apply to a `.docx`.
#[derive(Debug, Clone, PartialEq)]
pub struct Options {
    /// Heading level that starts a new chapter (1 to 3).
    pub split_heading_level: u8,
    /// Title for content that precedes the first chapter heading.
    pub untitled_title: String,
    /// Refuse archives whose declared uncompressed size exceeds this.
    pub max_decompressed_bytes: u64,
    /// Refuse archives with more entries than this.
    pub max_entries: usize,
    /// Refuse a `word/document.xml` whose declared uncompressed size exceeds this (no such option in the TypeScript importer).
    pub max_document_bytes: u64,
    /// Refuse any other XML part whose declared uncompressed size exceeds this (media only count toward the total).
    pub max_xml_part_bytes: u64,
    /// Caps on the XML trees built over the whole import.
    pub xml: XmlLimits,
    /// Deepest list nesting kept (never more than 8).
    pub max_nesting_depth: u32,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            split_heading_level: 1,
            untitled_title: "Untitled".into(),
            max_decompressed_bytes: 200 * 1024 * 1024,
            max_entries: 10_000,
            max_document_bytes: 64 * 1024 * 1024,
            max_xml_part_bytes: 16 * 1024 * 1024,
            xml: XmlLimits::default(),
            max_nesting_depth: 32,
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct ImportResult {
    pub chapters: Vec<Chapter>,
    pub warnings: Vec<Warning>,
    pub assets: Vec<Asset>,
}

fn missing_document(why: &str) -> ImportError {
    ImportError::new(ImportErrorCode::MissingDocument, why)
}

/// Imports a `.docx` held in memory. Pure: no disk or network access; image bytes are returned in `assets`.
/// Peak memory is the caller's `bytes` plus everything `import_files` holds; prefer [`import_docx_owned`] when the caller
/// does not need `bytes` afterwards (the app does, so this one is only used by tests).
#[cfg(test)]
pub fn import_docx(bytes: &[u8], opts: &Options) -> Result<ImportResult, ImportError> {
    import_files(read_archive(bytes, &limits_of(opts))?, opts)
}

/// [`import_docx`] for a caller that hands over the file's bytes: they are freed as soon as the archive has been inflated,
/// before any XML is parsed.
///
/// Peak memory model (n = file size, at most 200 MB; u = inflated wanted parts, at most `max_decompressed_bytes`):
/// 1. while unzipping: n + u (the file and the parts read so far);
/// 2. while parsing: u + the trees, because each XML part's bytes are taken out of the archive and freed as soon as that
///    part is parsed (only media stay), and the trees are bounded by `xml` (about 150 bytes per element, 300 MB at the
///    default cap, far less for any real book);
/// 3. while building: media + trees + the output (images are copied once into `assets`).
///
/// The file bytes never coexist with a tree.
pub fn import_docx_owned(bytes: Vec<u8>, opts: &Options) -> Result<ImportResult, ImportError> {
    let files = read_archive(&bytes, &limits_of(opts))?;
    drop(bytes);
    import_files(files, opts)
}

fn limits_of(opts: &Options) -> Limits {
    Limits {
        max_decompressed_bytes: opts.max_decompressed_bytes,
        max_entries: opts.max_entries,
        max_document_bytes: opts.max_document_bytes,
        max_xml_part_bytes: opts.max_xml_part_bytes,
    }
}

/// Takes a part out of the archive, parses it and frees its bytes; `None` when the archive has no such part.
fn parse_part(files: &mut Files, name: &str, label: &str, budget: &XmlBudget) -> Result<Option<Vec<XNode>>, ImportError> {
    let Some(bytes) = files.take(name) else { return Ok(None) };
    parse_xml_in(&bytes, label, budget).map(Some)
}

fn import_files(mut files: Files, opts: &Options) -> Result<ImportResult, ImportError> {
    let budget = XmlBudget::new(opts.xml);
    let top_rels = parse_rels(files.take("_rels/.rels").as_deref(), "_rels/.rels", &budget)?;
    let mut doc_path = "word/document.xml".to_string();
    for r in top_rels.iter() {
        if is_document_target(&r.target) && !r.external {
            doc_path = r.target.strip_prefix('/').unwrap_or(&r.target).to_string();
        }
    }
    let doc_name = if files.contains(&doc_path) { doc_path } else { "word/document.xml".to_string() };
    let Some(doc_xml) = parse_part(&mut files, &doc_name, "word/document.xml", &budget)? else {
        return Err(missing_document("The file has no word/document.xml, so it is not a Word document."));
    };
    let body = find_root(&doc_xml, "document").and_then(|d| child(d, "body"));
    let Some(body) = body else {
        return Err(missing_document("word/document.xml has no document body."));
    };

    let notes = collect_notes(&mut files, &budget)?;
    let rels = parse_rels(files.take("word/_rels/document.xml.rels").as_deref(), "word/_rels/document.xml.rels", &budget)?;
    let styles = match parse_part(&mut files, "word/styles.xml", "word/styles.xml", &budget)? {
        Some(roots) => parse_styles(&roots),
        None => HashMap::new(),
    };
    let numbering = match parse_part(&mut files, "word/numbering.xml", "word/numbering.xml", &budget)? {
        Some(roots) => parse_numbering(&roots),
        None => parts::Numbering::default(),
    };
    let mut ctx = DCtx { warn: Warnings::new(), assets: assets::AssetRegistry::new(), rels, styles, numbering, files, notes, comment_refs: 0 };

    let max_level = js_min(f64::from(opts.max_nesting_depth), 8.0);
    let mut builder = BodyBuilder::new(max_level);
    builder.walk(&mut ctx, kids(body), 0);
    builder.flush();

    // Comments, headers and footers live in other parts: report them so nothing disappears silently.
    let mut comments = u64::from(ctx.comment_refs);
    if let Some(roots) = parse_part(&mut ctx.files, "word/comments.xml", "word/comments.xml", &budget)? {
        let n = find_root(&roots, "comments").map_or(0, |r| children_named(r, "comment").count());
        comments = comments.max(n as u64);
    }
    if comments > 0 {
        ctx.warn.tally("comments", Severity::Warning, &format!("The file has {comments} comment(s); comments are not imported."), None);
    }
    let header_footer_names: Vec<String> = ctx.files.names().filter(|n| is_header_footer(n)).map(String::from).collect();
    let mut hf: Vec<String> = Vec::new();
    for name in header_footer_names {
        let roots = parse_part(&mut ctx.files, &name, &name, &budget)?.unwrap_or_default();
        let text = roots.first().map(|r| js_trim(&raw_text(r)).to_string()).unwrap_or_default();
        if !text.is_empty() {
            hf.push(text);
        }
    }
    for t in &hf {
        ctx.warn.tally("header-footer", Severity::Warning, "Headers and footers are not imported.", Some(t));
    }

    let chapters = split_chapters(builder.out, opts.split_heading_level, &opts.untitled_title, &mut ctx.warn);
    Ok(ImportResult { chapters, warnings: ctx.warn.into_list(), assets: ctx.assets.assets })
}

/// `/^word\/(header|footer)\d*\.xml$/`.
fn is_header_footer(name: &str) -> bool {
    ["header", "footer"].iter().any(|base| {
        name.strip_prefix("word/")
            .and_then(|r| r.strip_prefix(base))
            .and_then(|r| r.strip_suffix(".xml"))
            .is_some_and(|d| d.bytes().all(|b| b.is_ascii_digit()))
    })
}

#[cfg(test)]
mod contract_tests;
#[cfg(test)]
mod hostile_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub mod testutil;

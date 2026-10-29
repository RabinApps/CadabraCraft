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
pub mod node;
mod parts;
mod runs;
mod text;
pub mod warnings;
pub mod xml;

use archive::{read_archive, Limits};
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
use xml::{child, children_named, find_root, kids, parse_xml, raw_text};

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
    /// Deepest list nesting kept (never more than 8).
    pub max_nesting_depth: u32,
}

impl Default for Options {
    fn default() -> Options {
        Options { split_heading_level: 1, untitled_title: "Untitled".into(), max_decompressed_bytes: 200 * 1024 * 1024, max_entries: 10_000, max_nesting_depth: 32 }
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
pub fn import_docx(bytes: &[u8], opts: &Options) -> Result<ImportResult, ImportError> {
    let files = read_archive(bytes, &Limits { max_decompressed_bytes: opts.max_decompressed_bytes, max_entries: opts.max_entries })?;

    let top_rels = parse_rels(files.get("_rels/.rels"), "_rels/.rels")?;
    let mut doc_path = "word/document.xml".to_string();
    for r in top_rels.iter() {
        if is_document_target(&r.target) && !r.external {
            doc_path = r.target.strip_prefix('/').unwrap_or(&r.target).to_string();
        }
    }
    let doc_bytes = files.get(&doc_path).or_else(|| files.get("word/document.xml"));
    let Some(doc_bytes) = doc_bytes else {
        return Err(missing_document("The file has no word/document.xml, so it is not a Word document."));
    };

    let doc_xml = parse_xml(doc_bytes, "word/document.xml")?;
    let body = find_root(&doc_xml, "document").and_then(|d| child(d, "body"));
    let Some(body) = body else {
        return Err(missing_document("word/document.xml has no document body."));
    };

    let notes = collect_notes(&files)?;
    let rels = parse_rels(files.get("word/_rels/document.xml.rels"), "word/_rels/document.xml.rels")?;
    let styles = match files.get("word/styles.xml") {
        Some(b) => parse_styles(&parse_xml(b, "word/styles.xml")?),
        None => HashMap::new(),
    };
    let numbering = match files.get("word/numbering.xml") {
        Some(b) => parse_numbering(&parse_xml(b, "word/numbering.xml")?),
        None => parts::Numbering::default(),
    };
    let mut ctx = DCtx { warn: Warnings::new(), assets: assets::AssetRegistry::new(), rels, styles, numbering, files, notes, comment_refs: 0 };

    let max_level = js_min(f64::from(opts.max_nesting_depth), 8.0);
    let mut builder = BodyBuilder::new(max_level);
    builder.walk(&mut ctx, kids(body), 0);
    builder.flush();

    // Comments, headers and footers live in other parts: report them so nothing disappears silently.
    let mut comments = u64::from(ctx.comment_refs);
    if let Some(b) = ctx.files.get("word/comments.xml") {
        let roots = parse_xml(b, "word/comments.xml")?;
        let n = find_root(&roots, "comments").map_or(0, |r| children_named(r, "comment").count());
        comments = comments.max(n as u64);
    }
    if comments > 0 {
        ctx.warn.tally("comments", Severity::Warning, &format!("The file has {comments} comment(s); comments are not imported."), None);
    }
    let header_footer_names: Vec<String> = ctx.files.names().filter(|n| is_header_footer(n)).map(String::from).collect();
    let mut hf: Vec<String> = Vec::new();
    for name in header_footer_names {
        let bytes = ctx.files.get(&name).unwrap_or_default();
        let roots = parse_xml(bytes, &name)?;
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
mod tests;
#[cfg(test)]
pub mod testutil;

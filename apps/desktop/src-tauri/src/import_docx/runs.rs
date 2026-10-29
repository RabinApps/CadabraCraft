//! Runs and the inline content of a paragraph (`docx/runs.ts`): marks, links and fields, footnotes, line breaks, images.
use super::ctx::{DCtx, Field, PState};
use super::drawings::{drawing, pict};
use super::node::{Item, Mark, Node};
use super::text::{is_js_space, js_trim, merge_inline, slice_utf16, text_node};
use super::warnings::Severity;
use super::xml::{attr, child, child_val, children_named, descendants, kids, on, own_text, raw_text, tag_of, XNode};
use std::rc::Rc;
use tauri::Url;

const TRACKED: &str = "The file has tracked changes: insertions were accepted (kept), deletions were dropped.";
const PAGE_BREAK: &str = "Page and column breaks are ignored; use scene breaks for separations.";
const FIELD: &str = "Word fields (page numbers, tables of contents, cross-references) were replaced by their current text.";

/// The link policy of `safeHref` in `packages/shared`: only http, https and mailto, no white space, parsed and normalised
/// the way the WHATWG URL standard says.
pub fn safe_href(url: &str) -> Option<String> {
    let v = js_trim(url);
    if v.is_empty() || v.chars().any(is_js_space) {
        return None;
    }
    let lower = v.to_ascii_lowercase();
    if !(lower.starts_with("http:") || lower.starts_with("https:") || lower.starts_with("mailto:")) {
        return None;
    }
    let u = Url::parse(v).ok()?;
    matches!(u.scheme(), "http" | "https" | "mailto").then(|| u.to_string())
}

/// `/^\s*HYPERLINK\s+"([^"]+)"/i`: the quoted target of a `HYPERLINK` field instruction.
fn hyperlink_target(instr: &str) -> Option<&str> {
    let s = instr.trim_start_matches(is_js_space);
    let head = s.get(..9)?;
    if !head.eq_ignore_ascii_case("HYPERLINK") {
        return None;
    }
    let rest = &s[9..];
    let after = rest.trim_start_matches(is_js_space);
    if after.len() == rest.len() {
        return None;
    }
    let quoted = after.strip_prefix('"')?;
    let end = quoted.find('"').filter(|e| *e > 0)?;
    Some(&quoted[..end])
}

/// `/^\s*HYPERLINK/i`.
fn starts_with_hyperlink(instr: &str) -> bool {
    instr.trim_start_matches(is_js_space).get(..9).is_some_and(|h| h.eq_ignore_ascii_case("HYPERLINK"))
}

/// `instr.trim().split(/\s+/)[0]`: the field's keyword.
fn first_word(instr: &str) -> &str {
    js_trim(instr).split(is_js_space).next().unwrap_or("")
}

fn link_mark(ctx: &mut DCtx, href: &str, label: &str) -> Option<Mark> {
    if let Some(safe) = safe_href(href) {
        return Some(Mark::link(safe));
    }
    ctx.warn.tally(
        "unsafe-link",
        Severity::Warning,
        "Links are only kept for http, https and mailto; other links became plain text.",
        Some(&format!("{} ({label})", slice_utf16(href, 60))),
    );
    None
}

fn run_marks(ctx: &DCtx, rpr: Option<&XNode>) -> Vec<Mark> {
    let Some(rpr) = rpr else { return Vec::new() };
    let mut marks = Vec::new();
    let style = child_val(rpr, "rStyle").filter(|s| !s.is_empty()).and_then(|s| ctx.styles.get(s));
    if let Some(cs) = style {
        let name = cs.name.to_lowercase();
        if name != "hyperlink" {
            if cs.bold || name == "strong" {
                marks.push(Mark::of("bold"));
            }
            if cs.italic || name == "emphasis" {
                marks.push(Mark::of("italic"));
            }
            if cs.underline {
                marks.push(Mark::of("underline"));
            }
            if cs.small_caps {
                marks.push(Mark::of("smallCaps"));
            }
        }
    }
    if let Some(b) = child(rpr, "b") {
        if on(Some(b)) {
            marks.push(Mark::of("bold"));
        } else {
            marks.retain(|m| m.ty != "bold");
        }
    }
    marks.extend(more_marks(rpr));
    marks
}

fn more_marks(rpr: &XNode) -> Vec<Mark> {
    let mut m = Vec::new();
    if on(child(rpr, "i")) {
        m.push(Mark::of("italic"));
    }
    if let Some(u) = child(rpr, "u") {
        if !matches!(attr(u, "val"), Some("none" | "0")) {
            m.push(Mark::of("underline"));
        }
    }
    if on(child(rpr, "smallCaps")) {
        m.push(Mark::of("smallCaps"));
    }
    if on(child(rpr, "strike")) || on(child(rpr, "dstrike")) {
        m.push(Mark::of("strike"));
    }
    match child_val(rpr, "vertAlign") {
        Some("superscript") => m.push(Mark::of("superscript")),
        Some("subscript") => m.push(Mark::of("subscript")),
        _ => {}
    }
    m
}

/// The link of the innermost field that has one, else the link of the surrounding hyperlink element.
fn current_link<'a>(st: &'a PState, link: Option<&'a Mark>) -> Option<&'a Mark> {
    st.fields.iter().rev().find_map(|f| f.link.as_ref()).or(link)
}

fn push_text(st: &mut PState, text: &str, marks: &[Mark], link: Option<&Mark>) {
    if st.fields.last().is_some_and(|f| !f.in_result) {
        return;
    }
    let mut all = marks.to_vec();
    if let Some(l) = current_link(st, link) {
        all.push(l.clone());
    }
    if let Some(t) = text_node(text, &all) {
        st.items.push(Item::Node(t));
    }
}

fn process_run(ctx: &mut DCtx, st: &mut PState, r: &XNode, link: Option<&Mark>) {
    let rpr = child(r, "rPr");
    if on(rpr.and_then(|p| child(p, "vanish"))) {
        ctx.warn.tally("hidden-text", Severity::Info, "Hidden text was skipped.", Some(&raw_text(r)));
        return;
    }
    let marks = run_marks(ctx, rpr);
    run_children(ctx, st, kids(r), &marks, link);
}

fn run_children(ctx: &mut DCtx, st: &mut PState, list: &[XNode], marks: &[Mark], link: Option<&Mark>) {
    for c in list {
        let t = tag_of(c);
        match t {
            "t" => push_text(st, &own_text(c), marks, link),
            "tab" => push_text(st, " ", marks, link),
            "noBreakHyphen" => push_text(st, "-", marks, link),
            "br" => match attr(c, "type") {
                Some("page" | "column") => ctx.warn.tally("page-break", Severity::Info, PAGE_BREAK, None),
                _ => st.items.push(Item::Break),
            },
            "cr" => st.items.push(Item::Break),
            "fldChar" => field_char(ctx, st, attr(c, "fldCharType")),
            "instrText" => {
                if let Some(f) = st.fields.last_mut().filter(|f| !f.in_result) {
                    f.instr.push_str(&own_text(c));
                }
            }
            "footnoteReference" => note_ref(ctx, st, c, false),
            "endnoteReference" => note_ref(ctx, st, c, true),
            "drawing" => drawing(ctx, st, c),
            "pict" => pict(ctx, st, c),
            "object" => ctx.warn.tally("embedded-object", Severity::Warning, "Embedded objects (OLE, charts, equations editors) were skipped.", None),
            "AlternateContent" => {
                if let Some(choice) = child(c, "Choice").or_else(|| child(c, "Fallback")) {
                    run_children(ctx, st, kids(choice), marks, link);
                }
            }
            "commentReference" => ctx.comment_refs += 1,
            _ => {} // rPr, delText, lastRenderedPageBreak, footnoteRef, separators, sym
        }
    }
}

fn field_char(ctx: &mut DCtx, st: &mut PState, ty: Option<&str>) {
    match ty {
        Some("begin") => st.fields.push(Field { instr: String::new(), in_result: false, link: None }),
        Some("separate") => {
            let Some(idx) = st.fields.len().checked_sub(1) else { return };
            st.fields[idx].in_result = true;
            let instr = st.fields[idx].instr.clone();
            if let Some(target) = hyperlink_target(&instr) {
                st.fields[idx].link = link_mark(ctx, target, "field");
            } else if !starts_with_hyperlink(&instr) {
                ctx.warn.tally("field", Severity::Info, FIELD, Some(first_word(&instr)));
            }
        }
        Some("end") => {
            st.fields.pop();
        }
        _ => {}
    }
}

fn note_ref(ctx: &mut DCtx, st: &mut PState, c: &XNode, endnote: bool) {
    let id = attr(c, "id");
    if st.in_note {
        ctx.warn.tally("footnote-nested", Severity::Warning, "A note reference inside a note was dropped.", None);
        return;
    }
    let key = id.map(|id| format!("{}:{id}", if endnote { "endnote" } else { "footnote" }));
    let note = key.and_then(|k| ctx.notes.get(&k)).map(|n| Rc::clone(&n.el));
    let Some(note) = note else {
        ctx.warn.tally("footnote-missing", Severity::Warning, "A footnote or endnote reference pointed at a missing note and was dropped.", id);
        return;
    };
    if endnote {
        ctx.warn.tally("endnote", Severity::Info, "Endnotes are imported as footnotes.", None);
    }
    let n = note_node(ctx, &XNode::El(note));
    st.items.push(Item::Node(n));
}

/// A footnote node: the text of the note's paragraphs, joined with spaces (links and marks kept, images and nested notes dropped).
fn note_node(ctx: &mut DCtx, el: &XNode) -> Node {
    let mut parts: Vec<Node> = Vec::new();
    for p in children_named(el, "p") {
        let mut sub = PState::new(true);
        paragraph_children(ctx, &mut sub, kids(p), None);
        if !parts.is_empty() {
            parts.push(Node::plain_text(" "));
        }
        // A note never holds a lifted block (images in notes are dropped) or a nested footnote, so only text and breaks arrive.
        parts.extend(sub.items.into_iter().filter_map(|it| match it {
            Item::Break => Some(Node::plain_text(" ")),
            Item::Node(n) if n.is("text") => Some(n), _ => None, // the other arms are defensive: see above
        }));
    }
    if children_named(el, "tbl").next().is_some() {
        ctx.warn.tally("note-table", Severity::Warning, "A table inside a footnote was dropped.", None);
    }
    let mut content = merge_inline(parts);
    while content.first().is_some_and(|n| n.is("text") && js_trim(n.text.as_deref().unwrap_or("")).is_empty()) {
        content.remove(0);
    }
    if let Some(first) = content.first_mut().filter(|n| n.is("text")) {
        first.text = first.text.take().map(|t| t.trim_start_matches(is_js_space).to_string());
    }
    if content.is_empty() {
        Node::new("footnote")
    } else {
        Node::with("footnote", content)
    }
}

pub fn paragraph_children(ctx: &mut DCtx, st: &mut PState, list: &[XNode], link: Option<&Mark>) {
    for c in list {
        match tag_of(c) {
            "r" => process_run(ctx, st, c, link),
            "hyperlink" => {
                let rel = attr(c, "id").filter(|r| !r.is_empty()).and_then(|r| ctx.rels.get(r)).cloned();
                let mut m = None;
                match rel {
                    Some(r) if r.external => m = link_mark(ctx, &r.target, "hyperlink"),
                    _ => {
                        if let Some(anchor) = attr(c, "anchor") {
                            ctx.warn.tally("internal-link", Severity::Info, "Links to bookmarks inside the document were kept as plain text.", Some(anchor));
                        }
                    }
                }
                paragraph_children(ctx, st, kids(c), m.as_ref().or(link));
            }
            "fldSimple" => {
                let instr = attr(c, "instr").unwrap_or("");
                let m = match hyperlink_target(instr) {
                    Some(target) => link_mark(ctx, target, "field"),
                    None => {
                        ctx.warn.tally("field", Severity::Info, FIELD, Some(first_word(instr)));
                        None
                    }
                };
                paragraph_children(ctx, st, kids(c), m.as_ref().or(link));
            }
            "ins" | "moveTo" => {
                ctx.warn.tally("tracked-changes", Severity::Warning, TRACKED, Some(&raw_text(c)));
                paragraph_children(ctx, st, kids(c), link);
            }
            "del" | "moveFrom" => ctx.warn.tally("tracked-changes", Severity::Warning, TRACKED, Some(&raw_text(c))),
            "sdt" => {
                // A checkbox control at the start of a paragraph makes it a task item; its glyph is not text.
                let checkbox = child(c, "sdtPr").and_then(|p| child(p, "checkbox"));
                if let (Some(boxed), None, true, false) = (checkbox, st.checkbox, st.items.is_empty(), st.in_note) {
                    st.checkbox = Some(matches!(child_val(boxed, "checked"), Some("1" | "true" | "on")));
                    continue;
                }
                let content = child(c, "sdtContent").map(kids).unwrap_or(&[]);
                paragraph_children(ctx, st, content, link);
            }
            "sdtContent" | "smartTag" | "customXml" | "dir" | "bdo" => paragraph_children(ctx, st, kids(c), link),
            "oMath" | "oMathPara" => {
                let txt: String = descendants(c, "t").iter().map(|x| raw_text(x)).collect();
                ctx.warn.tally("equation", Severity::Warning, "Equations are not supported; their text was kept without layout.", Some(&txt));
                push_text(st, &txt, &[], link);
            }
            "AlternateContent" => {
                if let Some(choice) = child(c, "Choice").or_else(|| child(c, "Fallback")) {
                    paragraph_children(ctx, st, kids(choice), link);
                }
            }
            _ => {} // pPr, bookmarks, proofErr, comment ranges
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_limited_to_web_and_mail_and_normalised() {
        assert_eq!(safe_href("https://example.com/a?b=1").as_deref(), Some("https://example.com/a?b=1"));
        assert_eq!(safe_href("  HTTP://Example.com ").as_deref(), Some("http://example.com/"));
        assert_eq!(safe_href("mailto:a@b.co").as_deref(), Some("mailto:a@b.co"));
        for bad in ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "example.com", "", "  ", "https://a b.test", "http://", "ftp://x.test", "httpx:y"] {
            assert_eq!(safe_href(bad), None, "{bad}");
        }
    }

    #[test]
    fn field_instruction_parsing() {
        assert_eq!(hyperlink_target(r#" HYPERLINK "https://a.test" \o "tip""#), Some("https://a.test"));
        assert_eq!(hyperlink_target(r#"hyperlink "x""#), Some("x"));
        for no in [r#"HYPERLINK"x""#, r#"HYPERLINK x"#, r#"HYPERLINK """#, r#"HYPERLINK "unterminated"#, "PAGEREF x", "", "HYPER", "\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}"] {
            assert_eq!(hyperlink_target(no), None, "{no}");
        }
        assert!(starts_with_hyperlink("  hyperlink \\l x") && !starts_with_hyperlink("PAGE") && !starts_with_hyperlink("HYPER"));
        assert_eq!(first_word("  PAGEREF  x "), "PAGEREF");
        assert_eq!(first_word(""), "");
    }
}

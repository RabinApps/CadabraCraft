//! Block builders shared by every importer in TypeScript (`common/chapters.ts`): chapter splitting, list and task items,
//! definition lists and tables that fit the editor schema.
use super::node::{Attrs, Node};
use super::text::{collapse_ws, is_js_space, js_trim, paragraph_of, plain_text};
use super::warnings::{Severity, Warnings};

#[derive(Debug, Clone, PartialEq)]
pub struct Chapter {
    pub title: String,
    pub doc: Node,
}

/// Splits top-level blocks into chapters at headings of the split level. The heading stays in the chapter document.
/// Content before the first heading becomes a chapter with the untitled title.
pub fn split_chapters(blocks: Vec<Node>, level: u8, untitled: &str, warn: &mut Warnings) -> Vec<Chapter> {
    struct Cur {
        title: String,
        content: Vec<Node>,
        pre: bool,
    }
    let mut chapters: Vec<Cur> = Vec::new();
    let mut saw_heading = false;
    for b in blocks {
        if b.is("heading") && matches!(b.attrs, Some(Attrs::Heading { level: l, .. }) if l == level) {
            saw_heading = true;
            let t = js_trim(&plain_text(b.children())).to_string();
            let title = if t.is_empty() { untitled.to_string() } else { t };
            chapters.push(Cur { title, content: vec![b], pre: false });
            continue;
        }
        if chapters.is_empty() {
            chapters.push(Cur { title: untitled.to_string(), content: Vec::new(), pre: true });
        }
        if let Some(cur) = chapters.last_mut() {
            cur.content.push(b);
        }
    }
    if chapters.is_empty() {
        warn.at("empty-input", Severity::Warning, "The file contains no importable content.");
    } else if !saw_heading {
        warn.at("no-headings", Severity::Warning, &format!("No level {level} headings found, so the whole file is one chapter titled \"{untitled}\"."));
    } else if chapters[0].pre {
        warn.at("untitled-content", Severity::Warning, &format!("Content before the first level {level} heading was placed in a chapter titled \"{untitled}\"."));
    }
    chapters.into_iter().map(|c| Chapter { title: c.title, doc: Node::with("doc", c.content) }).collect()
}

/// A list item's content must satisfy `paragraph block*`.
pub fn list_item_of(content: Vec<Node>) -> Node {
    let c = if content.first().is_some_and(|n| n.is("paragraph")) {
        content
    } else {
        let mut c = vec![Node::paragraph()];
        c.extend(content);
        c
    };
    Node::with("listItem", c)
}

/// A task item: like a list item (starts with a paragraph) with a checked flag.
pub fn task_item_of(content: Vec<Node>, checked: bool) -> Node {
    let item = list_item_of(content);
    Node::with_attrs("taskItem", Attrs::Task { checked }, item.content.unwrap_or_default())
}

/// A term (inline content) or a description (blocks) read from a source, in order.
#[derive(Debug, Clone, PartialEq)]
pub enum DefinitionEntry {
    Term(Vec<Node>),
    Desc(Vec<Node>),
}

/// Blocks for a run of definition entries. The schema wants `(term+ description+)+`, so a description with no term before
/// it stays plain blocks in front of the list, and terms at the end that no description follows become paragraphs after it.
pub fn definition_nodes(entries: Vec<DefinitionEntry>) -> Vec<Node> {
    let mut before: Vec<Node> = Vec::new();
    let mut list: Vec<Node> = Vec::new();
    for e in entries {
        match e {
            DefinitionEntry::Term(content) => {
                list.push(if content.is_empty() { Node::new("definitionTerm") } else { Node::with("definitionTerm", content) });
            }
            DefinitionEntry::Desc(content) if list.is_empty() => before.extend(content),
            DefinitionEntry::Desc(content) => {
                list.push(Node::with("definitionDescription", list_item_of(content).content.unwrap_or_default()));
            }
        }
    }
    let mut after: Vec<Node> = Vec::new();
    while list.last().is_some_and(|n| n.is("definitionTerm")) {
        if let Some(term) = list.pop() {
            after.insert(0, paragraph_of(term.content.unwrap_or_default()));
        }
    }
    let mut out = before;
    if !list.is_empty() {
        out.push(Node::with("definitionList", list));
    }
    out.extend(after);
    out
}

/// A table cell must hold `paragraph+`: paragraphs stay, any other block is flattened to paragraphs. Says whether that
/// changed anything.
pub fn cell_paragraphs(blocks: Vec<Node>) -> (Vec<Node>, bool) {
    fn row_text(row: &Node) -> String {
        let cells: Vec<String> = row
            .children()
            .iter()
            .map(|c| {
                let inline: Vec<Node> = c.children().iter().flat_map(|p| p.children().iter().cloned()).collect();
                js_trim(&collapse_ws(&plain_text(&inline))).to_string()
            })
            .collect();
        cells.join(" | ")
    }
    fn walk(n: Node, out: &mut Vec<Node>, flattened: &mut bool) {
        match n.ty {
            "paragraph" => out.push(n),
            "heading" | "definitionTerm" => {
                *flattened = true;
                out.push(paragraph_of(n.content.unwrap_or_default()));
            }
            "bulletList" | "orderedList" | "taskList" | "definitionList" | "blockquote" | "listItem" | "taskItem" | "definitionDescription" => {
                *flattened = true;
                for k in n.content.unwrap_or_default() {
                    walk(k, out, flattened);
                }
            }
            "table" => {
                *flattened = true;
                for row in n.children() {
                    let t = row_text(row);
                    if !t.chars().all(|c| c == '|' || is_js_space(c)) {
                        out.push(paragraph_of(vec![Node::plain_text(&t)]));
                    }
                }
            }
            "codeBlock" => {
                *flattened = true;
                let t = plain_text(n.children());
                if !t.is_empty() {
                    out.push(paragraph_of(vec![Node::plain_text(&t)]));
                }
            }
            "image" => {
                *flattened = true;
                if let Some(Attrs::Image { alt: Some(alt), .. }) = &n.attrs {
                    if !alt.is_empty() {
                        out.push(paragraph_of(vec![Node::plain_text(alt)]));
                    }
                }
            }
            _ => *flattened = true,
        }
    }
    let mut paragraphs = Vec::new();
    let mut flattened = false;
    for b in blocks {
        walk(b, &mut paragraphs, &mut flattened);
    }
    if paragraphs.is_empty() {
        paragraphs.push(Node::paragraph());
    }
    (paragraphs, flattened)
}

/// A rectangular table from rows of cells (each a paragraph list). Short rows are padded with empty cells and the
/// result says so. `None` when there are no cells at all. Rows with no cells are dropped; the header is the first kept row.
pub fn table_of(rows: Vec<Vec<Vec<Node>>>, header_row: bool) -> (Option<Node>, bool) {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return (None, false);
    }
    let mut padded = false;
    let content: Vec<Node> = rows
        .into_iter()
        .filter(|r| !r.is_empty())
        .enumerate()
        .map(|(i, mut cells)| {
            if cells.len() < width {
                padded = true;
                cells.resize_with(width, || vec![Node::paragraph()]);
            }
            let ty = if header_row && i == 0 { "tableHeader" } else { "tableCell" };
            Node::with("tableRow", cells.into_iter().map(|c| Node::with(ty, c)).collect())
        })
        .collect();
    (Some(Node::with("table", content)), padded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import_docx::text::text_node;

    fn t(s: &str) -> Node {
        text_node(s, &[]).unwrap()
    }
    fn p(s: &str) -> Node {
        Node::with("paragraph", vec![t(s)])
    }
    fn heading(level: u8, s: &str) -> Node {
        Node::with_attrs("heading", Attrs::Heading { level, align: None }, if s.is_empty() { vec![] } else { vec![t(s)] })
    }
    fn titles(c: &[Chapter]) -> Vec<&str> {
        c.iter().map(|c| c.title.as_str()).collect()
    }
    fn codes(w: Warnings) -> Vec<String> {
        w.into_list().into_iter().map(|x| x.message).collect()
    }

    #[test]
    fn splits_chapters_at_the_split_level() {
        let mut w = Warnings::new();
        let c = split_chapters(vec![heading(1, " One "), p("a"), heading(2, "Sub"), heading(1, ""), p("b")], 1, "Untitled", &mut w);
        assert_eq!(titles(&c), ["One", "Untitled"]);
        assert_eq!(c[0].doc.children().len(), 3);
        assert_eq!(c[0].doc.ty, "doc");
        assert!(codes(w).is_empty());
    }

    #[test]
    fn warns_about_empty_input_missing_headings_and_untitled_content() {
        let mut w = Warnings::new();
        assert!(split_chapters(vec![], 1, "Untitled", &mut w).is_empty());
        assert_eq!(codes(w), ["The file contains no importable content."]);
        let mut w = Warnings::new();
        let c = split_chapters(vec![p("a"), heading(2, "x")], 1, "Front", &mut w);
        assert_eq!(titles(&c), ["Front"]);
        assert_eq!(codes(w), ["No level 1 headings found, so the whole file is one chapter titled \"Front\"."]);
        let mut w = Warnings::new();
        let c = split_chapters(vec![p("a"), heading(2, "x"), heading(2, "y")], 2, "T", &mut w);
        assert_eq!(titles(&c), ["T", "x", "y"]);
        assert_eq!(codes(w), ["Content before the first level 2 heading was placed in a chapter titled \"T\"."]);
    }

    #[test]
    fn list_and_task_items_start_with_a_paragraph() {
        assert_eq!(list_item_of(vec![p("a")]).children(), [p("a")]);
        let l = list_item_of(vec![Node::new("bulletList")]);
        assert_eq!(l.children().iter().map(|n| n.ty).collect::<Vec<_>>(), ["paragraph", "bulletList"]);
        assert_eq!(list_item_of(vec![]).children(), [Node::paragraph()]);
        let task = task_item_of(vec![p("a")], true);
        assert_eq!((task.ty, task.attrs.clone()), ("taskItem", Some(Attrs::Task { checked: true })));
        assert_eq!(task.children(), [p("a")]);
        assert_eq!(task_item_of(vec![], false).children(), [Node::paragraph()]);
    }

    #[test]
    fn definition_lists_keep_everything_the_schema_would_refuse() {
        use DefinitionEntry::*;
        let kinds = |v: Vec<Node>| v.iter().map(|n| n.ty).collect::<Vec<_>>();
        let out = definition_nodes(vec![Desc(vec![p("orphan")]), Term(vec![t("T1")]), Term(vec![]), Desc(vec![p("D1")]), Desc(vec![Node::new("bulletList")]), Term(vec![t("late")]), Term(vec![])]);
        assert_eq!(kinds(out.clone()), ["paragraph", "definitionList", "paragraph", "paragraph"]);
        assert_eq!(out[1].children().iter().map(|n| n.ty).collect::<Vec<_>>(), ["definitionTerm", "definitionTerm", "definitionDescription", "definitionDescription"]);
        assert_eq!(out[1].children()[1], Node::new("definitionTerm"), "an empty term has no content");
        assert_eq!(out[2], p("late"));
        assert_eq!(out[3], Node::paragraph(), "terms moved after the list keep their original order");
        assert!(definition_nodes(vec![Term(vec![t("x")])]) == [p("x")]);
        assert!(definition_nodes(vec![]).is_empty());
    }

    #[test]
    fn table_cells_are_flattened_to_paragraphs() {
        let img = Node { attrs: Some(Attrs::Image { src: "assets/a.png".into(), alt: Some("An image".into()) }), ..Node::new("image") };
        let img_no_alt = Node { attrs: Some(Attrs::Image { src: "assets/a.png".into(), alt: None }), ..Node::new("image") };
        let code = Node::with("codeBlock", vec![Node::plain_text("let x")]);
        let table = Node::with(
            "table",
            vec![
                Node::with("tableRow", vec![Node::with("tableCell", vec![p("a")]), Node::with("tableCell", vec![p("b"), p("c")])]),
                Node::with("tableRow", vec![Node::with("tableCell", vec![Node::paragraph()]), Node::with("tableCell", vec![Node::paragraph()])]),
            ],
        );
        let list = Node::with("bulletList", vec![Node::with("listItem", vec![p("item"), Node::with("bulletList", vec![Node::with("listItem", vec![p("deep")])])])]);
        let (out, flat) = cell_paragraphs(vec![p("plain")]);
        assert_eq!((out, flat), (vec![p("plain")], false));
        let (out, flat) = cell_paragraphs(vec![heading(2, "H"), list, table, code, img, img_no_alt, Node::new("sceneBreak"), Node::with("definitionList", vec![Node::with("definitionTerm", vec![t("term")]), Node::with("definitionDescription", vec![p("desc")])])]);
        assert!(flat);
        let texts: Vec<String> = out.iter().map(|n| plain_text(n.children())).collect();
        assert_eq!(texts, ["H", "item", "deep", "a | bc", "let x", "An image", "term", "desc"]);
        assert_eq!(cell_paragraphs(vec![]), (vec![Node::paragraph()], false));
        assert_eq!(cell_paragraphs(vec![Node::new("sceneBreak")]), (vec![Node::paragraph()], true));
        assert_eq!(cell_paragraphs(vec![Node::with("codeBlock", vec![])]).0, [Node::paragraph()]);
    }

    #[test]
    fn tables_are_padded_to_a_rectangle_with_the_header_on_the_first_kept_row() {
        let cell = |s: &str| vec![p(s)];
        assert_eq!(table_of(vec![], true), (None, false));
        assert_eq!(table_of(vec![vec![], vec![]], false), (None, false));
        let (node, padded) = table_of(vec![vec![cell("a"), cell("b")], vec![cell("c")], vec![], vec![cell("d"), cell("e")]], true);
        assert!(padded);
        let node = node.unwrap();
        let rows = node.children();
        assert_eq!(rows.len(), 3, "the empty row is dropped");
        assert_eq!(rows[0].children()[0].ty, "tableHeader");
        assert_eq!(rows[1].children()[0].ty, "tableCell");
        assert_eq!(rows[1].children()[1].children(), [Node::paragraph()]);
        let (node, padded) = table_of(vec![vec![], vec![cell("a")]], true);
        assert!(!padded);
        assert_eq!(node.unwrap().children()[0].children()[0].ty, "tableHeader", "the first kept row is the header");
        let (node, _) = table_of(vec![vec![cell("a")]], false);
        assert_eq!(node.unwrap().children()[0].children()[0].ty, "tableCell");
    }
}

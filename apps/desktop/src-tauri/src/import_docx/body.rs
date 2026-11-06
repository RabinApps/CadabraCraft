//! The document body: paragraphs, lists, quotes, code, definitions, tables (`docx/body.ts`).
use super::blocks::{cell_paragraphs, definition_nodes, list_item_of, table_of, task_item_of, DefinitionEntry};
use super::ctx::{DCtx, PState};
use super::node::{Attrs, Item, Node};
use super::parts::{classify, Cls};
use super::runs::paragraph_children;
use super::text::{flatten_items, is_js_space, is_scene_break_text, js_max, js_min, js_number, js_round, js_trim, merge_inline, paragraph_of, plain_text};
use super::warnings::Severity;
use super::xml::{attr, child, child_val, children_named, kids, on, raw_text, tag_of, XNode, MAX_XML_DEPTH};

struct ListEntry {
    ordered: bool,
    level: f64,
    content: Vec<Node>,
    /// A task item (a paragraph that began with a checkbox control): whether it is ticked.
    checked: Option<bool>,
}

fn list_type(e: &ListEntry) -> &'static str {
    match (e.checked, e.ordered) {
        (Some(_), _) => "taskList",
        (None, true) => "orderedList",
        (None, false) => "bulletList",
    }
}

/// Nested list nodes from entries with a level each. Levels never jump by more than one; a different kind of list at the
/// same level starts a new list. (Comparisons use `f64` so a nonsense level from the file behaves exactly as in JavaScript.)
fn build_lists(entries: Vec<ListEntry>) -> Vec<Node> {
    struct Frame {
        level: f64,
        ty: &'static str,
        items: Vec<Node>,
        /// Nested lists: (index of the item that holds it, index of its frame), in creation order.
        nested: Vec<(usize, usize)>,
    }
    fn assemble(frames: &mut [Frame], idx: usize) -> Node {
        let nested = std::mem::take(&mut frames[idx].nested);
        let mut items = std::mem::take(&mut frames[idx].items);
        for (at, child) in nested {
            let list = assemble(frames, child);
            if let Some(item) = items.get_mut(at) {
                item.content.get_or_insert_with(Vec::new).push(list);
            }
        }
        Node::with(frames[idx].ty, items)
    }
    let mut frames: Vec<Frame> = Vec::new();
    let mut roots: Vec<usize> = Vec::new();
    // The open frames, outermost first.
    let mut stack: Vec<usize> = Vec::new();
    for e in entries {
        let level = js_min(e.level, stack.last().map_or(0.0, |i| frames[*i].level + 1.0));
        while stack.last().is_some_and(|i| frames[*i].level > level) {
            stack.pop();
        }
        if stack.last().is_some_and(|i| frames[*i].level == level && frames[*i].ty != list_type(&e)) {
            stack.pop();
        }
        if stack.last().is_none_or(|i| frames[*i].level < level) {
            let idx = frames.len();
            frames.push(Frame { level, ty: list_type(&e), items: Vec::new(), nested: Vec::new() });
            // A nested list goes inside the last item of the list around it.
            match stack.last().copied() {
                Some(p) if frames[p].items.last().is_some_and(|it| it.is("listItem") || it.is("taskItem")) => {
                    let at = frames[p].items.len() - 1;
                    frames[p].nested.push((at, idx));
                }
                _ => roots.push(idx),
            }
            stack.push(idx);
        }
        let item = match e.checked {
            Some(c) => task_item_of(e.content, c),
            None => list_item_of(e.content),
        };
        if let Some(top) = stack.last() {
            frames[*top].items.push(item);
        }
    }
    roots.into_iter().map(|r| assemble(&mut frames, r)).collect()
}

/// A paragraph's items as blocks: runs of inline content become paragraphs (empty ones dropped), lifted blocks stay blocks.
fn split_items(items: &[Item]) -> (Vec<Node>, bool) {
    let mut blocks: Vec<Node> = Vec::new();
    let mut cur: Vec<Node> = Vec::new();
    let mut broke = false;
    fn flush(cur: &mut Vec<Node>, blocks: &mut Vec<Node>) {
        let c = merge_inline(std::mem::take(cur));
        if !js_trim(&plain_text(&c)).is_empty() || c.iter().any(|n| n.is("footnote")) {
            blocks.push(paragraph_of(c));
        }
    }
    for it in items {
        match it {
            Item::Node(n) => cur.push(n.clone()),
            Item::Break => {
                broke = true;
                flush(&mut cur, &mut blocks);
            }
            Item::Block(n) => {
                flush(&mut cur, &mut blocks);
                blocks.push(n.clone());
            }
        }
    }
    flush(&mut cur, &mut blocks);
    (blocks, broke)
}

pub struct BodyBuilder {
    pub out: Vec<Node>,
    list: Vec<ListEntry>,
    quote: Vec<Node>,
    code: Vec<String>,
    defs: Vec<DefinitionEntry>,
    max_level: f64,
}

impl BodyBuilder {
    pub fn new(max_level: f64) -> BodyBuilder {
        BodyBuilder { out: Vec::new(), list: Vec::new(), quote: Vec::new(), code: Vec::new(), defs: Vec::new(), max_level }
    }

    fn flush_list(&mut self) {
        if !self.list.is_empty() {
            let entries = std::mem::take(&mut self.list);
            self.out.extend(build_lists(entries));
        }
    }
    fn flush_quote(&mut self) {
        if !self.quote.is_empty() {
            self.out.push(Node::with("blockquote", std::mem::take(&mut self.quote)));
        }
    }
    /// Consecutive "Code" paragraphs become one code block, one line per paragraph (and per manual line break).
    fn flush_code(&mut self) {
        if !self.code.is_empty() {
            let text = self.code.join("\n");
            let mut node = Node::new("codeBlock");
            if !text.is_empty() {
                node.content = Some(vec![Node::plain_text(&text)]);
            }
            self.out.push(node);
            self.code.clear();
        }
    }
    /// Consecutive "Definition Term" and "Definition" paragraphs become one definition list.
    fn flush_defs(&mut self) {
        if !self.defs.is_empty() {
            let defs = std::mem::take(&mut self.defs);
            self.out.extend(definition_nodes(defs));
        }
    }
    pub fn flush(&mut self) {
        self.flush_list();
        self.flush_quote();
        self.flush_code();
        self.flush_defs();
    }

    /// The numbering of a paragraph: its own `numPr`, else the first one found on its style or the styles it is based on.
    fn numbering_of(ctx: &DCtx, ppr: Option<&XNode>, style_id: Option<&str>) -> (Option<String>, f64) {
        let num_pr = ppr.and_then(|p| child(p, "numPr"));
        let mut num_id = num_pr.and_then(|n| child_val(n, "numId")).map(String::from);
        let mut ilvl = num_pr.map_or(0.0, |n| child_val(n, "ilvl").map_or(0.0, js_number));
        if num_id.is_none() {
            let mut sid = style_id.filter(|s| !s.is_empty()).map(String::from);
            for _ in 0..12 {
                let Some(cur) = sid.take().filter(|s| !s.is_empty()) else { break };
                if num_id.is_some() {
                    break;
                }
                let s = ctx.styles.get(&cur);
                if let Some(n) = s.and_then(|s| s.num_id.clone()) {
                    num_id = Some(n);
                    ilvl = s.and_then(|s| s.ilvl).unwrap_or(0.0);
                }
                sid = s.and_then(|s| s.based_on.clone());
            }
        }
        (num_id, ilvl)
    }

    /// Notes the section and page breaks of a paragraph's properties (both are ignored on import).
    fn warn_breaks(ctx: &mut DCtx, ppr: Option<&XNode>) {
        let Some(ppr) = ppr else { return };
        if child(ppr, "sectPr").is_some() {
            ctx.warn.tally("section-break", Severity::Info, "Section breaks are ignored; use scene breaks for separations.", None);
        }
        if on(child(ppr, "pageBreakBefore")) {
            ctx.warn.tally("page-break", Severity::Info, "Page and column breaks are ignored; use scene breaks for separations.", None);
        }
    }

    /// Adds a code paragraph's lines: a line break ends a line, a lifted block does too.
    fn push_code(&mut self, items: &[Item]) {
        self.flush_list();
        self.flush_quote();
        let mut line = String::new();
        for i in items {
            match i {
                Item::Node(n) => line.push_str(&plain_text(std::slice::from_ref(n))),
                Item::Break | Item::Block(_) => self.code.push(std::mem::take(&mut line)),
            }
        }
        self.code.push(line);
    }

    /// A paragraph that begins with a Word checkbox control is a task item (nested by its list level or its indent).
    fn task_class(&self, cls: Cls, checked: bool, ppr: Option<&XNode>, st: &mut PState) -> Cls {
        let level = match &cls {
            Cls::List { level, .. } => *level,
            _ => {
                let left = ppr.and_then(|p| child(p, "ind")).map_or(0.0, |ind| attr(ind, "left").or_else(|| attr(ind, "start")).map_or(0.0, js_number));
                js_min(js_max(js_round(left / 720.0) - 1.0, 0.0), self.max_level)
            }
        };
        if let Some(Item::Node(first)) = st.items.first_mut() {
            if first.is("text") {
                first.text = first.text.take().map(|t| t.trim_start_matches(is_js_space).to_string());
            }
        }
        Cls::List { ordered: false, level, checked: Some(checked) }
    }

    /// A heading: deeper than level 3 is clamped (with a warning); lifted blocks follow it.
    fn push_heading(&mut self, ctx: &mut DCtx, h: u8, text: &str, align: Option<&'static str>, items: Vec<Item>) {
        self.flush();
        let mut level = h;
        if level > 3 {
            ctx.warn.tally("heading-clamped", Severity::Warning, "Headings deeper than level 3 were changed to level 3.", Some(&format!("Heading {level}: {text}")));
            level = 3;
        }
        let flat = flatten_items(&items);
        if !js_trim(&plain_text(&flat)).is_empty() || flat.iter().any(|n| n.is("footnote")) {
            self.out.push(Node::with_attrs("heading", Attrs::Heading { level, align }, flat));
        }
        for i in items {
            if let Item::Block(n) = i {
                self.out.push(n);
            }
        }
    }

    /// Files the paragraph's blocks under its class: a definition, a list item, a quote or the body.
    fn push_classified(&mut self, cls: Cls, blocks: Vec<Node>, items: Vec<Item>) {
        match cls {
            Cls::DefTerm => {
                self.flush_list();
                self.flush_quote();
                self.defs.push(DefinitionEntry::Term(flatten_items(&items)));
                let lifted: Vec<Node> = items.into_iter().filter_map(|i| if let Item::Block(n) = i { Some(n) } else { None }).collect();
                if !lifted.is_empty() {
                    self.defs.push(DefinitionEntry::Desc(lifted));
                }
            }
            Cls::DefDesc => {
                self.flush_list();
                self.flush_quote();
                if blocks.is_empty() {
                    return;
                }
                match self.defs.last_mut() {
                    Some(DefinitionEntry::Desc(last)) => last.extend(blocks),
                    _ => self.defs.push(DefinitionEntry::Desc(blocks)),
                }
            }
            Cls::List { ordered, level, checked } => {
                self.flush_quote();
                if blocks.is_empty() {
                    return;
                }
                self.list.push(ListEntry { ordered, level, content: blocks, checked });
            }
            Cls::Quote => {
                self.flush_list();
                self.quote.extend(blocks);
            }
            _ => {
                self.flush();
                self.out.extend(blocks);
            }
        }
    }

    pub fn paragraph(&mut self, ctx: &mut DCtx, p: &XNode) {
        let ppr = child(p, "pPr");
        let mut st = PState::new(false);
        paragraph_children(ctx, &mut st, kids(p), None);
        Self::warn_breaks(ctx, ppr);
        let style_id = ppr.and_then(|p| child_val(p, "pStyle"));
        let mut cls = classify(style_id, &ctx.styles);
        if let Cls::Normal { fallback: Some(name) } = &cls {
            ctx.warn.tally("style-fallback", Severity::Info, "Custom paragraph styles were imported as normal paragraphs.", Some(name));
        }

        // Code paragraphs hold plain text only; one with a footnote or an image is kept as a normal paragraph instead of losing them.
        let has_rich = st.items.iter().any(|i| match i {
            Item::Block(_) => true,
            Item::Break => false,
            Item::Node(n) => n.is("footnote"),
        });
        if cls == Cls::Code && has_rich {
            cls = Cls::Normal { fallback: None };
        }
        if !matches!(cls, Cls::DefTerm | Cls::DefDesc) {
            self.flush_defs();
        }
        if cls == Cls::Code {
            self.push_code(&st.items);
            return;
        }
        self.flush_code();

        // list membership via numPr (paragraph first, then style)
        if matches!(cls, Cls::Normal { .. } | Cls::List { .. }) {
            let (num_id, ilvl) = Self::numbering_of(ctx, ppr, style_id);
            if let Some(num_id) = num_id {
                if let Some(ordered) = ctx.numbering.ordered(&num_id, ilvl) {
                    cls = Cls::List { ordered, level: js_min(js_max(ilvl, 0.0), self.max_level), checked: None };
                }
            }
        }

        if let (Some(checked), true) = (st.checkbox, matches!(cls, Cls::Normal { .. } | Cls::List { .. })) {
            cls = self.task_class(cls, checked, ppr, &mut st);
        }

        let inline: Vec<Node> = st.items.iter().filter_map(|i| if let Item::Node(n) = i { Some(n.clone()) } else { None }).collect();
        let text = plain_text(&inline);
        let jc = ppr.and_then(|p| child_val(p, "jc"));
        // Only a paragraph's own centre or right is the author's choice. Left (start, justified) is what the style says, which
        // generators write on every paragraph, so reading it would make a whole book ragged.
        let align = match jc {
            Some("center") => Some("center"),
            Some("right" | "end") => Some("end"),
            _ => None,
        };
        let has_blocks = st.items.iter().any(|i| matches!(i, Item::Block(_)));

        if matches!(cls, Cls::Normal { .. }) && jc == Some("center") && !has_blocks && is_scene_break_text(js_trim(&text)) {
            self.flush();
            self.out.push(Node::new("sceneBreak"));
            return;
        }

        if let Cls::Heading(h) = cls {
            self.push_heading(ctx, h, &text, align, st.items);
            return;
        }

        let (blocks, broke_lines) = split_items(&st.items);
        let blocks: Vec<Node> = blocks.into_iter().map(|b| b.aligned(align)).collect();
        if broke_lines {
            ctx.warn.tally("line-break", Severity::Info, "Manual line breaks split the paragraph into separate paragraphs.", None);
        }
        self.push_classified(cls, blocks, st.items);
    }

    fn table(&mut self, ctx: &mut DCtx, t: &XNode) {
        self.flush();
        let mut merged = false;
        let mut complex = false;
        let mut rows: Vec<Vec<Vec<Node>>> = Vec::new();
        let trs: Vec<&XNode> = children_named(t, "tr").collect();
        for r in &trs {
            let mut cells: Vec<Vec<Node>> = Vec::new();
            for c in children_named(r, "tc") {
                let tc_pr = child(c, "tcPr");
                let span = tc_pr.and_then(|p| child_val(p, "gridSpan")).map_or(1.0, js_number);
                let vm = tc_pr.and_then(|p| child(p, "vMerge"));
                let mut sub = BodyBuilder::new(self.max_level);
                sub.walk(ctx, kids(c), 0);
                sub.flush();
                let (paragraphs, flattened) = cell_paragraphs(sub.out);
                complex |= flattened;
                cells.push(paragraphs);
                // Merged cells are not supported: the covered grid slots become empty cells so the table stays rectangular.
                if vm.is_some() || (span.fract() == 0.0 && span.is_finite() && span > 1.0) {
                    merged = true;
                }
                let mut i = 1.0;
                while i < js_min(span, 64.0) {
                    cells.push(vec![Node::paragraph()]);
                    i += 1.0;
                }
            }
            rows.push(cells);
        }
        let header = trs.first().and_then(|r| child(r, "trPr")).is_some_and(|p| on(child(p, "tblHeader")));
        let (node, padded) = table_of(rows, header);
        if complex {
            ctx.warn.tally("table-complex", Severity::Warning, "Nested tables, lists and images inside table cells were flattened to paragraphs.", Some(&raw_text(t)));
        }
        if merged || padded {
            ctx.warn.tally("table-merged", Severity::Warning, "Merged table cells were split into separate cells (the covered cells are empty).", Some(&raw_text(t)));
        }
        if let Some(n) = node {
            self.out.push(n);
        }
    }

    pub fn walk(&mut self, ctx: &mut DCtx, list: &[XNode], depth: usize) {
        if depth > MAX_XML_DEPTH {
            return;
        }
        for n in list {
            match tag_of(n) {
                "p" => self.paragraph(ctx, n),
                "tbl" => self.table(ctx, n),
                "sdt" => self.walk(ctx, child(n, "sdtContent").map(kids).unwrap_or(&[]), depth + 1),
                "sdtContent" | "customXml" | "ins" => self.walk(ctx, kids(n), depth + 1),
                "del" | "moveFrom" => ctx.warn.tally(
                    "tracked-changes",
                    Severity::Warning,
                    "The file has tracked changes: insertions were accepted (kept), deletions were dropped.",
                    Some(&raw_text(n)),
                ),
                "sectPr" | "bookmarkStart" | "bookmarkEnd" | "proofErr" | "commentRangeStart" | "commentRangeEnd" | "permStart" | "permEnd" | "#text" => {}
                other => ctx.warn.tally("unsupported-element", Severity::Warning, "Unrecognised document elements were skipped.", Some(other)),
            }
        }
    }
}

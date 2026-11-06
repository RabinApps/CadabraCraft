//! Nested list nodes built from numbered paragraphs (`docx/body.ts`).
use super::blocks::{list_item_of, task_item_of};
use super::node::Node;
use super::text::js_min;

pub(super) struct ListEntry {
    pub(super) ordered: bool,
    pub(super) level: f64,
    pub(super) content: Vec<Node>,
    /// A task item (a paragraph that began with a checkbox control): whether it is ticked.
    pub(super) checked: Option<bool>,
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
pub(super) fn build_lists(entries: Vec<ListEntry>) -> Vec<Node> {
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

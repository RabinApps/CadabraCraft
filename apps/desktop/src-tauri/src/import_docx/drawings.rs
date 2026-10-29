//! Images and drawings inside runs (`docx/drawings.ts`).
use super::assets::{ext_of, image_type};
use super::ctx::{DCtx, PState};
use super::node::{Attrs, Item, Node};
use super::parts::resolve_part;
use super::warnings::Severity;
use super::xml::{attr, descendants, raw_text, XNode};

const MISSING: &str = "An image could not be found in the file and was skipped.";
const UNSUPPORTED_DRAWING: &str = "Drawings, shapes, charts and diagrams are not supported and were skipped.";
const TEXT_BOX: &str = "Text boxes are not supported; their text was not imported.";

fn image_from_rel(ctx: &mut DCtx, st: &mut PState, rid: Option<&str>, alt: Option<&str>) {
    let rel = rid.filter(|r| !r.is_empty()).and_then(|r| ctx.rels.get(r)).filter(|r| !r.external).cloned();
    let Some(rel) = rel else {
        ctx.warn.tally("missing-image", Severity::Warning, MISSING, Some(rid.unwrap_or("no relationship")));
        return;
    };
    let path = resolve_part(&rel.target);
    let ext = ext_of(&path);
    if ctx.files.get(&path).is_none() {
        ctx.warn.tally("missing-image", Severity::Warning, MISSING, Some(&path));
        return;
    }
    let Some(media) = image_type(&ext) else {
        ctx.warn.tally("unsupported-image-format", Severity::Warning, "Images in formats other than PNG, JPEG, GIF, WebP or SVG were skipped.", Some(&path));
        return;
    };
    if st.in_note {
        ctx.warn.tally("note-image", Severity::Warning, "Images inside footnotes are not supported and were skipped.", Some(&path));
        return;
    }
    let bytes = ctx.files.get(&path).map(<[u8]>::to_vec).unwrap_or_default();
    let i = ctx.assets.register(&path, media, bytes);
    let src = ctx.assets.assets[i].target_path.clone();
    let alt = alt.filter(|a| !a.is_empty()).map(String::from);
    st.items.push(Item::Block(Node { attrs: Some(Attrs::Image { src, alt }), ..Node::new("image") }));
}

pub fn drawing(ctx: &mut DCtx, st: &mut PState, d: &XNode) {
    let blips = descendants(d, "blip");
    let tx = descendants(d, "txbxContent");
    let doc_pr = descendants(d, "docPr").into_iter().next();
    if let Some(first) = tx.first() {
        ctx.warn.tally("text-box", Severity::Warning, TEXT_BOX, Some(&raw_text(first)));
    }
    if !blips.is_empty() {
        for b in blips {
            image_from_rel(ctx, st, attr(b, "embed"), doc_pr.and_then(|p| attr(p, "descr")));
        }
    } else if tx.is_empty() {
        ctx.warn.tally("unsupported-drawing", Severity::Warning, UNSUPPORTED_DRAWING, doc_pr.and_then(|p| attr(p, "name")));
    }
}

pub fn pict(ctx: &mut DCtx, st: &mut PState, p: &XNode) {
    let tx = descendants(p, "txbxContent");
    let imgs = descendants(p, "imagedata");
    if let Some(first) = tx.first() {
        ctx.warn.tally("text-box", Severity::Warning, TEXT_BOX, Some(&raw_text(first)));
    }
    for i in &imgs {
        image_from_rel(ctx, st, attr(i, "id"), attr(i, "title"));
    }
    if tx.is_empty() && imgs.is_empty() {
        ctx.warn.tally("unsupported-drawing", Severity::Warning, UNSUPPORTED_DRAWING, None);
    }
}

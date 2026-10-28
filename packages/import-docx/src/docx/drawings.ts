import { IMAGE_TYPES, extOf } from "../common";
import { attr, descendants, rawText, type XNode } from "./xml";
import { resolvePart } from "./relationships";
import type { PState } from "./types";

function imageFromRel(rid: string | undefined, alt: string | undefined, st: PState): void {
  const ctx = st.ctx;
  const rel = rid ? ctx.rels.get(rid) : undefined;
  if (!rel || rel.external) {
    ctx.warn.tally(
      "missing-image",
      "warning",
      "An image could not be found in the file and was skipped.",
      rid ?? "no relationship",
    );
    return;
  }
  const path = resolvePart(rel.target);
  const bytes = ctx.files[path];
  const ext = extOf(path);
  if (!bytes) {
    ctx.warn.tally(
      "missing-image",
      "warning",
      "An image could not be found in the file and was skipped.",
      path,
    );
    return;
  }
  if (!IMAGE_TYPES[ext]) {
    ctx.warn.tally(
      "unsupported-image-format",
      "warning",
      "Images in formats other than PNG, JPEG, GIF, WebP or SVG were skipped.",
      path,
    );
    return;
  }
  if (st.inNote) {
    ctx.warn.tally(
      "note-image",
      "warning",
      "Images inside footnotes are not supported and were skipped.",
      path,
    );
    return;
  }
  const a = ctx.assets.register(path, IMAGE_TYPES[ext], bytes);
  st.items.push({
    sep: "block",
    node: { type: "image", attrs: { src: a.targetPath, alt: alt || null, title: null } },
  });
}

export function drawing(d: XNode, st: PState): void {
  const blips = descendants(d, "blip");
  const tx = descendants(d, "txbxContent");
  const docPr = descendants(d, "docPr")[0];
  if (tx.length)
    st.ctx.warn.tally(
      "text-box",
      "warning",
      "Text boxes are not supported; their text was not imported.",
      rawText(tx[0]!),
    );
  if (blips.length) {
    for (const b of blips)
      imageFromRel(attr(b, "embed"), docPr ? attr(docPr, "descr") : undefined, st);
  } else if (!tx.length) {
    st.ctx.warn.tally(
      "unsupported-drawing",
      "warning",
      "Drawings, shapes, charts and diagrams are not supported and were skipped.",
      docPr ? attr(docPr, "name") : undefined,
    );
  }
}

export function pict(p: XNode, st: PState): void {
  const tx = descendants(p, "txbxContent");
  const imgs = descendants(p, "imagedata");
  if (tx.length)
    st.ctx.warn.tally(
      "text-box",
      "warning",
      "Text boxes are not supported; their text was not imported.",
      rawText(tx[0]!),
    );
  for (const i of imgs) imageFromRel(attr(i, "id"), attr(i, "title"), st);
  if (!tx.length && !imgs.length)
    st.ctx.warn.tally(
      "unsupported-drawing",
      "warning",
      "Drawings, shapes, charts and diagrams are not supported and were skipped.",
    );
}

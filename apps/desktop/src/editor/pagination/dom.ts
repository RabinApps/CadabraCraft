import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { BlockCache, BlockStyle } from "./cache";
import { blockKind, lineMetrics, type FlowBlock, type PageSpec } from "./core";

/**
 * The thin DOM side of Page view pagination: it reads layout from the editor's DOM (heights, margins, where a line wraps) and hands
 * plain numbers to `core.ts`. Everything is measured at zoom 1: client rects are divided by the zoom, computed styles are not scaled.
 * Reading happens with the `pv-natural` class on the editor (spacers hidden), so blocks are measured as they flow without page breaks.
 */

const px = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** The top-level block elements of the editor (not the spacers or other widgets), in document order. */
function blockElements(view: EditorView): HTMLElement[] {
  const out: HTMLElement[] = [];
  view.state.doc.forEach((_node, offset) => {
    const el = view.nodeDOM(offset);
    out.push(el as HTMLElement);
  });
  return out;
}

const countTextBlocks = (node: PMNode): number => {
  if (node.isTextblock) return 1;
  let n = 0;
  node.descendants((d) => {
    if (d.isTextblock) n++;
    return !d.isTextblock;
  });
  return n;
};

function readStyle(el: HTMLElement, node: PMNode): BlockStyle {
  const cs = getComputedStyle(el);
  const text = node.isTextblock ? el : (el.querySelector("p, pre") ?? el);
  const tcs = text === el ? cs : getComputedStyle(text);
  const lh = px(tcs.lineHeight);
  return {
    marginTop: px(cs.marginTop),
    marginBottom: px(cs.marginBottom),
    lineHeight: lh > 0 ? lh : px(tcs.fontSize) * 1.2,
    textBlocks: countTextBlocks(node),
  };
}

/**
 * Measures every top-level block. Style (margins, line height) comes from the cache by node identity; the box (top and height) is
 * read from the DOM each time, which is one cheap rect read per block after a single layout.
 */
export function measureFlow(
  view: EditorView,
  zoom: number,
  columnTop: number,
  cache: BlockCache,
): FlowBlock[] {
  const rootTop = view.dom.getBoundingClientRect().top;
  const els = blockElements(view);
  const out: FlowBlock[] = [];
  view.state.doc.forEach((node, _offset, index) => {
    const el = els[index];
    if (!el || !(el instanceof HTMLElement)) return;
    let style = cache.get(node);
    if (!style) {
      style = readStyle(el, node);
      cache.set(node, style);
    }
    const rect = el.getBoundingClientRect();
    const kind = blockKind(node.type.name, node.attrs.level as number | undefined, index);
    const height = rect.height / zoom;
    const { lines, lineHeight } = lineMetrics(kind, height, style.lineHeight, style.textBlocks);
    out.push({
      kind,
      height,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      lineHeight,
      lines,
      top: (rect.top - rootTop) / zoom - columnTop,
    });
  });
  return out;
}

/**
 * The document position of the first character on line `linesBefore + 1` of a block: a binary search over the block's positions for
 * the first one drawn at or below that line's top. Null when the block has no text position there (the gap is then not drawn).
 */
export function findSplitPos(
  view: EditorView,
  blockPos: number,
  node: PMNode,
  linesBefore: number,
  block: FlowBlock,
  zoom: number,
  columnTop: number,
): number | null {
  const rootTop = view.dom.getBoundingClientRect().top;
  const lh = block.lineHeight * zoom;
  const target = rootTop + (columnTop + block.top) * zoom + linesBefore * lh - lh / 2;
  let lo = blockPos + 1;
  let hi = blockPos + node.nodeSize - 1;
  try {
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (view.coordsAtPos(mid).top >= target) hi = mid;
      else lo = mid + 1;
    }
    // Land on a text position that is not inside a footnote's own text.
    const doc = view.state.doc;
    for (let p = lo; p < blockPos + node.nodeSize; p++) {
      const $p = doc.resolve(p);
      if ($p.parent.inlineContent && $p.parent.type.name !== "footnote") return p;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * `linesBefore` for a page that begins at `pos` inside a block (see `PageBreak`): the number of the block's lines the previous page
 * keeps. A position at the start of a line keeps the lines above it; one in the middle of a line keeps that line too (it is cut
 * short by the spacer, and the rest of it starts the next page). Null when the position cannot be placed.
 */
export function linesBeforePos(
  view: EditorView,
  blockPos: number,
  node: PMNode,
  pos: number,
  block: FlowBlock,
  zoom: number,
  columnTop: number,
): number | null {
  const rootTop = view.dom.getBoundingClientRect().top;
  const lh = block.lineHeight * zoom;
  try {
    const y = view.coordsAtPos(pos).top - (rootTop + (columnTop + block.top) * zoom);
    const line = Math.max(0, Math.floor((y + lh / 2) / lh));
    const atStart = findSplitPos(view, blockPos, node, line, block, zoom, columnTop) === pos;
    return atStart ? line : line + 1;
  } catch {
    return null;
  }
}

/** The top of every page card as the content actually flows: the bottom of each spacer minus the top margin. Null when a spacer is missing. */
export function readPageTops(
  view: EditorView,
  zoom: number,
  gapCount: number,
  marginTop: number,
): number[] | null {
  const rootTop = view.dom.getBoundingClientRect().top;
  const tops: number[] = [0];
  const seen = new Map<number, number>();
  for (const el of view.dom.querySelectorAll<HTMLElement>(".pv-gap")) {
    const k = Number(el.dataset.gap);
    seen.set(k, (el.getBoundingClientRect().bottom - rootTop) / zoom - marginTop);
  }
  for (let k = 0; k < gapCount; k++) {
    const t = seen.get(k);
    if (t === undefined) return null;
    tops.push(t);
  }
  return tops;
}

/** The 0-based page the cursor is on, from the card tops. */
export function cursorPage(view: EditorView, zoom: number, pages: PageSpec[]): number {
  const y =
    (view.coordsAtPos(view.state.selection.head).top - view.dom.getBoundingClientRect().top) / zoom;
  let page = 0;
  for (const p of pages) if (p.top <= y + 1) page = p.index;
  return page;
}

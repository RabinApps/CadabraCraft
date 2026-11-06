import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { DocSpan } from "../../lib/page/pageLayout";
import { blockFragments, isVerso, type CutSpec, type GapSpec, type PageLayoutResult } from "./core";

/** The document position of a split inside a block, or null when none could be found (that gap is then left out). */
export type SplitResolver = (block: number, linesBefore: number) => number | null;

export interface GapWidgetSpec {
  inline: boolean;
  height: number;
  marginTop: number;
  marginBottom: number;
  /** Position in the chapter's gap list (the page it ends). */
  index: number;
  key: string;
  /** For the spacer of one cell of a table row a page begins in: the cell's content and the row (see `CellCut`). */
  cell?: DocSpan;
  row?: DocSpan;
}

const LETTER = /^\p{L}$/u;

/** True when the document has a letter on both sides of `pos`: a line that breaks there breaks inside a word. */
export function breaksMidWord(doc: PMNode, pos: number): boolean {
  if (pos < 1 || pos >= doc.content.size) return false;
  const [before, after] = [...doc.textBetween(pos - 1, pos + 1, "￼", "￼")];
  return before !== undefined && after !== undefined && LETTER.test(before) && LETTER.test(after);
}

/** The hyphen drawn at the end of the last line of a page when a word is split across the page break (the spacer replaces the browser's own). */
function hyphenElement(): HTMLElement {
  const el = document.createElement("span");
  el.className = "pv-hyphen";
  el.contentEditable = "false";
  el.setAttribute("aria-hidden", "true");
  el.textContent = "-";
  // Zero width: the hyphen hangs past the end of the line instead of taking room, so the line breaks exactly as it did without it.
  el.style.cssText = "display:inline-block;width:0;overflow:visible;white-space:nowrap";
  return el;
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

/** The spacer element: not editable, not selectable, taller than whatever is left of the page so the next page's text starts on the next card. */
function gapElement(spec: GapWidgetSpec): HTMLElement {
  const el = document.createElement(spec.inline ? "span" : "div");
  el.className = spec.inline ? "pv-gap pv-gap-inline" : "pv-gap";
  el.contentEditable = "false";
  el.setAttribute("aria-hidden", "true");
  el.dataset.gap = String(spec.index);
  el.style.height = px(spec.height);
  if (spec.marginTop) el.style.marginTop = px(spec.marginTop);
  if (spec.marginBottom) el.style.marginBottom = px(spec.marginBottom);
  return el;
}

/** The spacer is a piece of a line (a break inside a line of text), not a block between blocks or items. */
const inlineGap = (gap: GapSpec): boolean => gap.linesBefore > 0 && !gap.flow;

const widget = (pos: number, gap: GapSpec, index: number): Decoration => {
  const inline = inlineGap(gap);
  const spec: GapWidgetSpec = {
    inline,
    height: gap.height,
    marginTop: gap.marginTop,
    marginBottom: gap.marginBottom,
    index,
    key: `pv:${index}:${inline ? "i" : "b"}:${px(gap.height)}:${px(gap.marginTop)}:${px(gap.marginBottom)}`,
  };
  // side -1: the cursor at this position is drawn after the spacer, on the page the text continues on.
  return Decoration.widget(pos, () => gapElement(spec), {
    side: -1,
    key: spec.key,
    ignoreSelection: true,
    pvGap: spec,
  });
};

/** The spacer of one cell of a table row that a page begins in (`n`th of the gap's cells). */
const cutWidget = (cut: CutSpec, index: number, n: number): Decoration => {
  const spec: GapWidgetSpec = {
    inline: cut.inline,
    height: cut.height,
    marginTop: cut.marginTop,
    marginBottom: cut.marginBottom,
    index,
    key: `pv:${index}:c${n}:${cut.inline ? "i" : "b"}:${px(cut.height)}:${px(cut.marginBottom)}`,
    cell: cut.cell,
    row: cut.row,
  };
  return Decoration.widget(cut.pos, () => gapElement(spec), {
    side: -1,
    key: spec.key,
    ignoreSelection: true,
    pvGap: spec,
  });
};

/**
 * Which page each piece of a block's text is on, as `[from, to, page]` (a block that is one piece has none: it is decorated as a whole).
 * A page break inside a table row has a cut per cell, so the row is not cut at one place: each of its cells has its own pieces, those
 * of a cell that ends before the page break being on the row's first page, and the text after the row is on the row's last.
 */
function pieces(
  node: PMNode,
  offset: number,
  frag: { startPage: number; splits: number[] },
  lookup: {
    gaps: Map<string, { gap: GapSpec; index: number }>;
    resolved: Map<string, number>;
    block: number;
  },
): [number, number, number][] {
  const { gaps, resolved, block } = lookup;
  const out: [number, number, number][] = [];
  let at = offset + 1;
  let page = frag.startPage;
  const to = (pos: number, pg: number) => {
    if (at < pos) out.push([at, pos, page]);
    at = Math.max(at, pos);
    page = pg;
  };
  let j = 0;
  while (j < frag.splits.length) {
    const entry = gaps.get(`${block}:${frag.splits[j]}`);
    const cuts = entry?.gap.cuts;
    if (!cuts) {
      // A split that could not be placed leaves its piece joined to the one before it.
      const pos = resolved.get(`${block}:${frag.splits[j]}`);
      if (pos !== undefined) to(pos, frag.startPage + j + 1);
      j++;
      continue;
    }
    // The gaps of one row: consecutive, and the same row.
    const row = cuts[0]!.row;
    const byCell = new Map<number, { pos: number; page: number }[]>();
    let last = j;
    while (last < frag.splits.length) {
      const g = gaps.get(`${block}:${frag.splits[last]}`);
      if (!g?.gap.cuts || g.gap.cuts[0]!.row.from !== row.from) break;
      for (const c of g.gap.cuts)
        byCell.set(c.cell.from, [
          ...(byCell.get(c.cell.from) ?? []),
          { pos: c.pos, page: g.index },
        ]);
      last++;
    }
    to(row.from, page);
    const rowPage = page;
    for (const cell of row.cells) {
      const mine = byCell.get(cell.from) ?? [];
      let from = cell.from;
      let pg = rowPage;
      for (const c of mine) {
        if (from < c.pos) out.push([from, c.pos, c.page]);
        from = c.pos;
        pg = c.page + 1;
      }
      if (from < cell.to) out.push([from, cell.to, pg]);
    }
    at = row.to;
    page = frag.startPage + last;
    j = last;
  }
  if (at < offset + node.nodeSize - 1) out.push([at, offset + node.nodeSize - 1, page]);
  return out;
}

/**
 * The decorations of one pagination result, all of them view-only (nothing here touches the document, the selection or the undo
 * history): a spacer widget at every page break, and a `pv-verso` class (a sideways shift by the difference of the mirrored margins)
 * on the text that sits on left-hand pages. A block that starts and ends on one left-hand page gets a node decoration; a block split
 * across pages gets inline decorations on the pieces that are on left-hand pages.
 */
export function buildDecorations(
  doc: PMNode,
  layout: PageLayoutResult,
  firstPage: number,
  splitPos: SplitResolver,
  hyphenate = false,
): DecorationSet {
  const out: Decoration[] = [];
  const starts: number[] = [];
  doc.forEach((_node, offset) => starts.push(offset));
  const resolved = new Map<string, number>();
  layout.gaps.forEach((gap, index) => {
    if (gap.cuts) {
      // A page that begins inside a table row: a spacer in each cell that runs onto it.
      resolved.set(`${gap.block}:${gap.linesBefore}`, gap.cuts[0]!.pos);
      gap.cuts.forEach((cut, n) => {
        out.push(cutWidget(cut, index, n));
        if (hyphenate && cut.inline && breaksMidWord(doc, cut.pos))
          out.push(
            Decoration.widget(cut.pos, hyphenElement, {
              side: -2,
              key: `pv-hyphen:${index}:${n}`,
              ignoreSelection: true,
            }),
          );
      });
      return;
    }
    const pos = gap.linesBefore === 0 ? starts[gap.block] : splitPos(gap.block, gap.linesBefore);
    if (pos === undefined || pos === null) return;
    resolved.set(`${gap.block}:${gap.linesBefore}`, pos);
    out.push(widget(pos, gap, index));
    // side -2: before the spacer, so the hyphen ends the line on the page the word starts on.
    if (hyphenate && inlineGap(gap) && breaksMidWord(doc, pos))
      out.push(
        Decoration.widget(pos, hyphenElement, {
          side: -2,
          key: `pv-hyphen:${index}`,
          ignoreSelection: true,
        }),
      );
  });

  const byBreak = new Map<string, { gap: GapSpec; index: number }>();
  layout.gaps.forEach((gap, index) =>
    byBreak.set(`${gap.block}:${gap.linesBefore}`, { gap, index }),
  );
  const fragments = blockFragments(layout.breaks, doc.childCount);
  doc.forEach((node, offset, i) => {
    const frag = fragments[i]!;
    // The pieces of the block that start at a placed split, with the page each one is on (a split that could not be placed
    // leaves its piece joined to the one before it).
    const parts = pieces(node, offset, frag, { gaps: byBreak, resolved, block: i });
    if (parts.length <= 1) {
      if (isVerso(firstPage + (parts[0]?.[2] ?? frag.startPage)))
        out.push(Decoration.node(offset, offset + node.nodeSize, { class: "pv-verso" }));
      return;
    }
    for (const [from, to, page] of parts)
      if (isVerso(firstPage + page)) out.push(Decoration.inline(from, to, { class: "pv-verso" }));
  });
  return DecorationSet.create(doc, out);
}

/** The gap widgets of a decoration set, in document order (for tests and for reading the card tops back). */
export const gapSpecs = (set: DecorationSet, doc: PMNode): GapWidgetSpec[] =>
  set
    .find(0, doc.content.size, (spec: { pvGap?: GapWidgetSpec }) => spec.pvGap !== undefined)
    .map((d) => (d as unknown as { spec: { pvGap: GapWidgetSpec } }).spec.pvGap);

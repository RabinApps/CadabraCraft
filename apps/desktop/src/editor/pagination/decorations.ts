import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { blockFragments, isVerso, type GapSpec, type PageLayoutResult } from "./core";

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

const widget = (pos: number, gap: GapSpec, index: number): Decoration => {
  const inline = gap.linesBefore > 0;
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
    const pos = gap.linesBefore === 0 ? starts[gap.block] : splitPos(gap.block, gap.linesBefore);
    if (pos === undefined || pos === null) return;
    resolved.set(`${gap.block}:${gap.linesBefore}`, pos);
    out.push(widget(pos, gap, index));
    // side -2: before the spacer, so the hyphen ends the line on the page the word starts on.
    if (hyphenate && gap.linesBefore > 0 && breaksMidWord(doc, pos))
      out.push(
        Decoration.widget(pos, hyphenElement, {
          side: -2,
          key: `pv-hyphen:${index}`,
          ignoreSelection: true,
        }),
      );
  });

  const fragments = blockFragments(layout.breaks, doc.childCount);
  doc.forEach((node, offset, i) => {
    const frag = fragments[i]!;
    // The pieces of the block that start at a placed split, with the page each one is on (a split that could not be placed
    // leaves its piece joined to the one before it).
    const pieces = [{ at: offset + 1, page: frag.startPage }];
    frag.splits.forEach((n, j) => {
      const pos = resolved.get(`${i}:${n}`);
      if (pos !== undefined) pieces.push({ at: pos, page: frag.startPage + j + 1 });
    });
    if (pieces.length === 1) {
      if (isVerso(firstPage + frag.startPage))
        out.push(Decoration.node(offset, offset + node.nodeSize, { class: "pv-verso" }));
      return;
    }
    const end = offset + node.nodeSize - 1;
    pieces.forEach((piece, j) => {
      const to = pieces[j + 1]?.at ?? end;
      if (piece.at < to && isVerso(firstPage + piece.page))
        out.push(Decoration.inline(piece.at, to, { class: "pv-verso" }));
    });
  });
  return DecorationSet.create(doc, out);
}

/** The gap widgets of a decoration set, in document order (for tests and for reading the card tops back). */
export const gapSpecs = (set: DecorationSet, doc: PMNode): GapWidgetSpec[] =>
  set
    .find(0, doc.content.size, (spec: { pvGap?: GapWidgetSpec }) => spec.pvGap !== undefined)
    .map((d) => (d as unknown as { spec: { pvGap: GapWidgetSpec } }).spec.pvGap);

import { afterEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { Decoration } from "@tiptap/pm/view";
import { buildDecorations, gapSpecs } from "../decorations";
import { layoutPages, type FlowBlock } from "../core";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
});
const p = (len: number) => schema.node("paragraph", null, [schema.text("x".repeat(len))]);

const LH = 20;
const block = (top: number, lines: number): FlowBlock => ({
  kind: "paragraph",
  top,
  height: lines * LH,
  lines,
  lineHeight: LH,
  marginTop: 0,
  marginBottom: 0,
});
const layoutOf = (counts: number[], firstPage: number) => {
  let top = 0;
  const blocks = counts.map((n) => {
    const b = block(top, n);
    top += n * LH;
    return b;
  });
  return layoutPages({
    blocks,
    page: { h: 400 },
    margins: { top: 40, bottom: 40 },
    textHeight: 320,
    gap: 24,
    firstPage,
    startsOn: "any",
    opensChapter: false,
  });
};
const classes = (decos: Decoration[]) =>
  decos.map((d) => ({
    from: d.from,
    to: d.to,
    cls: (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class,
  }));

const isGap = (spec: { pvGap?: unknown }) => spec.pvGap !== undefined;

describe("buildDecorations", () => {
  // Blocks of 15 and 3 lines: the second moves to page 2; 30 lines: the paragraph splits at line 16.
  it("puts a block-level gap at the start of the block a page starts in", () => {
    const doc = schema.node("doc", null, [p(10), p(20)]);
    const layout = layoutOf([15, 3], 1);
    const set = buildDecorations(doc, layout, 1, () => null);
    const gaps = gapSpecs(set, doc);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ inline: false, index: 0, height: layout.gaps[0]!.height });
    // block 1 starts after the 12 positions of the first paragraph (10 characters + 2 tokens)
    expect(set.find(12, 12, isGap)).toHaveLength(1);
  });

  it("places a split's gap inside the paragraph at the resolved position, inline", () => {
    const doc = schema.node("doc", null, [p(100)]);
    const layout = layoutOf([30], 1);
    const set = buildDecorations(doc, layout, 1, (b, n) => (b === 0 && n === 16 ? 50 : null));
    const gaps = gapSpecs(set, doc);
    expect(gaps.map((g) => g.inline)).toEqual([true]);
    expect(set.find(50, 50, isGap)).toHaveLength(1);
  });

  it("leaves a split out when no text position was found", () => {
    const doc = schema.node("doc", null, [p(100)]);
    const set = buildDecorations(doc, layoutOf([30], 1), 1, () => null);
    expect(gapSpecs(set, doc)).toEqual([]);
  });

  it("shifts whole blocks that sit on left-hand pages with a node decoration", () => {
    const doc = schema.node("doc", null, [p(10), p(20)]);
    // first page is page 1 (right-hand); block 1 lands on page 2 (left-hand)
    const set = buildDecorations(doc, layoutOf([15, 3], 1), 1, () => null);
    const shifted = classes(set.find()).filter((d) => d.cls === "pv-verso");
    expect(shifted).toEqual([{ from: 12, to: 34, cls: "pv-verso" }]);
    // starting on page 2 flips which block is shifted
    const flipped = buildDecorations(doc, layoutOf([15, 3], 2), 2, () => null);
    expect(classes(flipped.find()).filter((d) => d.cls === "pv-verso")).toEqual([
      { from: 0, to: 12, cls: "pv-verso" },
    ]);
  });

  it("shifts only the piece of a split paragraph that is on a left-hand page", () => {
    const doc = schema.node("doc", null, [p(100)]);
    const set = buildDecorations(doc, layoutOf([30], 1), 1, (b, n) =>
      b === 0 && n === 16 ? 50 : null,
    );
    expect(classes(set.find()).filter((d) => d.cls === "pv-verso")).toEqual([
      { from: 50, to: 101, cls: "pv-verso" },
    ]);
    // on a left-hand first page it is the first piece
    const first = buildDecorations(doc, layoutOf([30], 2), 2, (b, n) =>
      b === 0 && n === 16 ? 50 : null,
    );
    expect(classes(first.find()).filter((d) => d.cls === "pv-verso")).toEqual([
      { from: 1, to: 50, cls: "pv-verso" },
    ]);
  });

  describe("a page that begins inside a table row", () => {
    // One block of 100 characters (positions 1 to 101) standing in for a table with a row of two cells: positions 1-51 and 51-101.
    const row = {
      from: 0,
      to: 102,
      cells: [
        { from: 1, to: 51 },
        { from: 51, to: 101 },
      ],
    };
    const cut = (pos: number, cell: 0 | 1, prevY: number | null, y: number, inline = true) => ({
      pos,
      y,
      prevY,
      inline,
      marginBottom: 0,
      cell: row.cells[cell]!,
      row,
    });
    const table: FlowBlock = { ...block(0, 30), kind: "table", height: 700, lineHeight: 700 };
    const layoutOfCuts = (firstPage: number, ...breaks: ReturnType<typeof cut>[][]) =>
      layoutPages({
        blocks: [table],
        page: { h: 400 },
        margins: { top: 40, bottom: 40 },
        textHeight: 320,
        gap: 24,
        firstPage,
        startsOn: "any",
        opensChapter: false,
        forced: breaks.map((cuts, k) => ({
          block: 0,
          linesBefore: k + 1,
          blankBefore: false,
          at: { y: Math.max(...cuts.map((c) => c.y)), flow: true, cuts },
        })),
      });
    const doc = schema.node("doc", null, [p(100)]);
    const verso = (set: ReturnType<typeof buildDecorations>) =>
      classes(set.find()).filter((d) => d.cls === "pv-verso");

    it("draws a spacer in each cell, with its own height, inline for a word and a block between paragraphs", () => {
      const layout = layoutOfCuts(1, [cut(20, 0, null, 300), cut(60, 1, null, 320, false)]);
      const set = buildDecorations(doc, layout, 1, () => null);
      const specs = gapSpecs(set, doc);
      expect(specs.map((s) => [s.index, s.inline, s.height, s.cell, s.row?.from])).toEqual([
        [0, true, 124, row.cells[0], 0],
        [0, false, 104, row.cells[1], 0],
      ]);
      expect(specs[0]!.key).not.toBe(specs[1]!.key);
      expect(set.find(20, 20, isGap)).toHaveLength(1);
      expect(set.find(60, 60, isGap)).toHaveLength(1);
    });

    it("puts the hyphen where a cell's word is cut in the middle", () => {
      const made = buildDecorations(
        doc,
        layoutOfCuts(1, [cut(20, 0, null, 300)]),
        1,
        () => null,
        true,
      );
      // The text is all one letter: a cut at 20 is inside a word.
      expect(made.find(20, 20, (spec: { side?: number }) => spec.side !== undefined)).toHaveLength(
        2,
      );
      // A spacer between paragraphs is no word cut.
      const block = buildDecorations(
        doc,
        layoutOfCuts(1, [cut(20, 0, null, 300, false)]),
        1,
        () => null,
        true,
      );
      expect(block.find(20, 20, (spec: { side?: number }) => spec.side !== undefined)).toHaveLength(
        1,
      );
    });

    it("shifts the text of each cell by the page it is on: the cell that runs over is on two pages, the one that ends is on the first", () => {
      // The first page is a right-hand page: only what is on the second (left-hand) page is shifted, the tail of the first cell.
      const set = buildDecorations(doc, layoutOfCuts(1, [cut(20, 0, null, 300)]), 1, () => null);
      expect(verso(set)).toEqual([{ from: 20, to: 51, cls: "pv-verso" }]);
      // The first page is a left-hand page: the first cell's head and the second cell are shifted, not its tail.
      const flipped = buildDecorations(
        doc,
        layoutOfCuts(2, [cut(20, 0, null, 300)]),
        2,
        () => null,
      );
      expect(verso(flipped)).toEqual([
        { from: 1, to: 20, cls: "pv-verso" },
        { from: 51, to: 101, cls: "pv-verso" },
      ]);
    });

    it("follows a cell over two page breaks, and a cell that starts running over later than its neighbour only on the break it is cut at", () => {
      const layout = layoutOfCuts(
        1,
        [cut(20, 0, null, 300), cut(70, 1, null, 320)],
        [cut(35, 0, 300, 640)],
      );
      const set = buildDecorations(doc, layout, 1, () => null);
      // Pages 1, 2, 3 (right, left, right): cell 0 is on the left-hand page between 20 and 35; cell 1 from its cut on.
      expect(verso(set)).toEqual([
        { from: 20, to: 35, cls: "pv-verso" },
        { from: 70, to: 101, cls: "pv-verso" },
      ]);
      expect(gapSpecs(set, doc).map((s) => s.index)).toEqual([0, 1, 0]);
    });
  });

  it("builds the spacer element with its height and margins", () => {
    const doc = schema.node("doc", null, [p(100)]);
    const set = buildDecorations(doc, layoutOf([30], 1), 1, () => 50);
    const spec = gapSpecs(set, doc)[0]!;
    expect(spec.key).toContain("pv:0:i:");
  });

  it("draws the spacer as a hidden, non-editable element sized by the layout", () => {
    // No DOM in Vitest: a tiny stand-in for createElement is enough to see what the element is given.
    const made: Record<string, unknown>[] = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        const el = {
          tag,
          className: "",
          contentEditable: "",
          dataset: {} as Record<string, string>,
          attrs: {} as Record<string, string>,
          style: {} as Record<string, string>,
          setAttribute(k: string, v: string) {
            this.attrs[k] = v;
          },
        };
        made.push(el);
        return el;
      },
    });
    const doc = schema.node("doc", null, [p(100), p(20)]);
    const inline = buildDecorations(doc, layoutOf([30], 1), 1, () => 50);
    const inlineEl = (
      inline.find(50, 50, isGap)[0] as unknown as { type: { toDOM: () => unknown } }
    ).type.toDOM() as Record<string, unknown>;
    expect(inlineEl).toMatchObject({
      tag: "span",
      className: "pv-gap pv-gap-inline",
      contentEditable: "false",
      dataset: { gap: "0" },
      attrs: { "aria-hidden": "true" },
    });
    expect((inlineEl.style as Record<string, string>).marginTop).toBeUndefined();
    const layout = layoutOf([15, 3], 1);
    const block = buildDecorations(doc, layout, 1, () => null);
    const el = (
      block.find(0, 200, isGap)[0] as unknown as { type: { toDOM: () => unknown } }
    ).type.toDOM() as Record<string, unknown>;
    expect(el).toMatchObject({ tag: "div", className: "pv-gap" });
    expect((el.style as Record<string, string>).height).toBe(`${layout.gaps[0]!.height}px`);
    // margins that cancel a neighbour's are set when there are some
    const margins = buildDecorations(
      doc,
      { ...layout, gaps: [{ ...layout.gaps[0]!, marginTop: -6, marginBottom: -9 }] },
      1,
      () => null,
    );
    const m = (
      margins.find(0, 200, isGap)[0] as unknown as { type: { toDOM: () => unknown } }
    ).type.toDOM() as { style: Record<string, string> };
    expect(m.style).toMatchObject({ marginTop: "-6px", marginBottom: "-9px" });
  });
});

describe("hyphen at a split inside a word", () => {
  const doc = schema.node("doc", null, [p(100)]);
  const at50 = (b: number, n: number) => (b === 0 && n === 16 ? 50 : null);
  const hyphensOf = (d: typeof doc, set: ReturnType<typeof buildDecorations>) =>
    set.find(0, d.content.size, (s: { key?: string }) => !!s.key?.startsWith("pv-hyphen"));

  it("adds a hyphen widget before the spacer when hyphenation is on and the break is mid-word", () => {
    const found = hyphensOf(doc, buildDecorations(doc, layoutOf([30], 1), 1, at50, true));
    expect(found.map((d) => d.from)).toEqual([50]);
  });

  it("draws the hyphen as a zero-width, non-editable span", () => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => ({
        tag,
        className: "",
        contentEditable: "",
        textContent: "",
        attrs: {} as Record<string, string>,
        style: {} as Record<string, string>,
        setAttribute(k: string, v: string) {
          this.attrs[k] = v;
        },
      }),
    });
    const found = hyphensOf(doc, buildDecorations(doc, layoutOf([30], 1), 1, at50, true));
    const el = (found[0] as unknown as { type: { toDOM: () => unknown } }).type.toDOM() as {
      tag: string;
      className: string;
      contentEditable: string;
      textContent: string;
      attrs: Record<string, string>;
      style: { cssText: string };
    };
    expect(el).toMatchObject({
      tag: "span",
      className: "pv-hyphen",
      contentEditable: "false",
      textContent: "-",
      attrs: { "aria-hidden": "true" },
    });
    expect(el.style.cssText).toContain("width:0");
  });

  it("adds none when hyphenation is off", () => {
    expect(hyphensOf(doc, buildDecorations(doc, layoutOf([30], 1), 1, at50, false))).toHaveLength(
      0,
    );
  });

  it("adds none when the break is at a space or a hyphen", () => {
    for (const text of ["a ".repeat(50), "a-".repeat(50)]) {
      const d = schema.node("doc", null, [schema.node("paragraph", null, [schema.text(text)])]);
      expect(hyphensOf(d, buildDecorations(d, layoutOf([30], 1), 1, at50, true))).toHaveLength(0);
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

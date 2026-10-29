import { describe, expect, it } from "vitest";
import {
  blockFragments,
  blockKind,
  isVerso,
  layoutPages,
  lineMetrics,
  withTops,
  type FlowBlock,
  type LayoutInput,
} from "../core";

const LH = 20;
/** A paragraph of `lines` lines at `top`, as the DOM adapter would report it. */
const para = (top: number, lines: number, mb = 0): FlowBlock => ({
  kind: "paragraph",
  top,
  height: lines * LH,
  lines,
  lineHeight: LH,
  marginTop: 0,
  marginBottom: mb,
});
/** Blocks one after another with the margins collapsed as CSS does. */
const flow = (counts: number[], mb = 0): FlowBlock[] => {
  let top = 0;
  return counts.map((n) => {
    const b = para(top, n, mb);
    top += n * LH + mb;
    return b;
  });
};
const input = (blocks: FlowBlock[], over: Partial<LayoutInput> = {}): LayoutInput => ({
  blocks,
  page: { h: 400 },
  margins: { top: 40, bottom: 40 },
  textHeight: 320, // 16 lines
  gap: 24,
  firstPage: 1,
  startsOn: "any",
  opensChapter: false,
  ...over,
});

describe("layoutPages with forced breaks", () => {
  it("follows the given breaks and says it is exact; the estimate says it is not", () => {
    const blocks = flow([4, 6, 8]);
    expect(layoutPages(input(blocks)).exact).toBe(false);
    const forced = [{ block: 1, linesBefore: 0, blankBefore: false }];
    const layout = layoutPages(input(blocks, { forced }));
    expect(layout.exact).toBe(true);
    expect(layout.breaks).toEqual(forced);
    // The page before the break uses what is on it, the next starts at the next block.
    expect(layout.pages.map((p) => p.number)).toEqual([1, 2]);
    expect(layout.gaps).toHaveLength(1);
    expect(layout.gaps[0]).toMatchObject({ block: 1, linesBefore: 0, height: 400 + 24 - 4 * LH });
  });

  it("breaks inside a block at the line it is given", () => {
    const blocks = flow([10]);
    const layout = layoutPages(
      input(blocks, { forced: [{ block: 0, linesBefore: 3, blankBefore: false }] }),
    );
    expect(layout.gaps[0]).toMatchObject({ block: 0, linesBefore: 3, height: 400 + 24 - 3 * LH });
    expect(layout.pages).toHaveLength(2);
  });

  it("sizes the spacer of each cell of a row a page begins in by where that cell's own text was cut", () => {
    // One table, 700 px tall; the row's first page is cut at 300 px in one cell and 320 in the other, the second page is cut once
    // more in the first cell (340 px after its earlier cut) and the row ends there.
    const table: FlowBlock = { ...para(0, 1), kind: "table", height: 700, lineHeight: 700 };
    const row = {
      from: 10,
      to: 90,
      cells: [
        { from: 11, to: 50 },
        { from: 51, to: 89 },
      ],
    };
    const cut = (pos: number, y: number, prevY: number | null, cell: 0 | 1, inline = true) => ({
      pos,
      y,
      prevY,
      inline,
      marginBottom: inline ? 0 : -5,
      cell: row.cells[cell]!,
      row,
    });
    const layout = layoutPages(
      input([table], {
        forced: [
          {
            block: 0,
            linesBefore: 1,
            blankBefore: false,
            at: { y: 320, flow: true, cuts: [cut(20, 300, null, 0), cut(60, 320, null, 1, false)] },
          },
          {
            block: 0,
            linesBefore: 2,
            blankBefore: false,
            at: { y: 640, flow: true, cuts: [cut(30, 640, 300, 0)] },
          },
        ],
      }),
    );
    const [one, two] = layout.gaps;
    expect(one!.cuts).toEqual([
      expect.objectContaining({ pos: 20, inline: true, height: 400 + 24 - 300, marginBottom: 0 }),
      expect.objectContaining({ pos: 60, inline: false, height: 400 + 24 - 320, marginBottom: -5 }),
    ]);
    expect(one!.cuts![0]).not.toHaveProperty("y");
    // 340 px of text on the page is more than the page holds: the spacer is as the card grows (margins and the gap).
    expect(two!.cuts).toEqual([
      expect.objectContaining({ pos: 30, height: 80 + 24, marginTop: 0 }),
    ]);
    // A gap that is not in a row has no cuts.
    expect(
      layoutPages(input(flow([10]), { forced: [{ block: 0, linesBefore: 3, blankBefore: false }] }))
        .gaps[0],
    ).not.toHaveProperty("cuts");
  });

  it("an empty forced list is one exact page", () => {
    const layout = layoutPages(input(flow([4]), { forced: [] }));
    expect(layout).toMatchObject({ exact: true, gaps: [], breaks: [] });
    expect(layout.pages).toHaveLength(1);
  });
});

describe("blockKind", () => {
  it("maps ProseMirror nodes to block kinds; only the opening heading 1 is the chapter title", () => {
    expect(blockKind("heading", 1, 0)).toBe("chapterTitle");
    expect(blockKind("heading", 1, 3)).toBe("heading");
    expect(blockKind("heading", 2, 0)).toBe("heading");
    expect(blockKind("paragraph", undefined, 0)).toBe("paragraph");
    expect(blockKind("blockquote", undefined, 1)).toBe("blockquote");
    expect(blockKind("bulletList", undefined, 1)).toBe("list");
    expect(blockKind("orderedList", undefined, 1)).toBe("list");
    expect(blockKind("codeBlock", undefined, 1)).toBe("code");
    expect(blockKind("sceneBreak", undefined, 1)).toBe("sceneBreak");
    expect(blockKind("table", undefined, 1)).toBe("table");
    expect(blockKind("image", undefined, 1)).toBe("image");
    expect(blockKind("somethingNew", undefined, 1)).toBe("other");
  });
});

describe("lineMetrics", () => {
  it("splits paragraphs by lines with the line pitch taken from the height", () => {
    expect(lineMetrics("paragraph", 100.5, 20, 1)).toEqual({ lines: 5, lineHeight: 20.1 });
    expect(lineMetrics("heading", 40, 20, 1)).toEqual({ lines: 2, lineHeight: 20 });
    expect(lineMetrics("paragraph", 5, 20, 1)).toEqual({ lines: 1, lineHeight: 5 });
  });
  it("splits quotes, lists and code only when they are one text block of whole lines", () => {
    expect(lineMetrics("blockquote", 80, 20, 1)).toEqual({ lines: 4, lineHeight: 20 });
    expect(lineMetrics("list", 80, 20, 2)).toEqual({ lines: 1, lineHeight: 80 });
    expect(lineMetrics("code", 93, 20, 1)).toEqual({ lines: 1, lineHeight: 93 });
    expect(lineMetrics("table", 80, 20, 1)).toEqual({ lines: 1, lineHeight: 80 });
  });
  it("copes with nothing to measure", () => {
    expect(lineMetrics("paragraph", 0, 20, 1)).toEqual({ lines: 1, lineHeight: 0 });
    expect(lineMetrics("paragraph", 50, 0, 1)).toEqual({ lines: 1, lineHeight: 50 });
  });
});

describe("blockFragments", () => {
  it("tells which page each block starts on and where it splits", () => {
    const breaks = [
      { block: 1, linesBefore: 0, blankBefore: false },
      { block: 1, linesBefore: 4, blankBefore: false },
      { block: 2, linesBefore: 0, blankBefore: false },
    ];
    expect(blockFragments(breaks, 3)).toEqual([
      { startPage: 0, splits: [] },
      { startPage: 1, splits: [4] },
      { startPage: 3, splits: [] },
    ]);
  });
  it("starts a chapter after its blank page", () => {
    expect(blockFragments([{ block: 0, linesBefore: 0, blankBefore: true }], 1)).toEqual([
      { startPage: 1, splits: [] },
    ]);
  });
  it("knows left-hand pages", () => {
    expect([1, 2, 3, 4].map(isVerso)).toEqual([false, true, false, true]);
  });
});

describe("layoutPages", () => {
  it("is one page for a short chapter and has no gaps", () => {
    const r = layoutPages(input(flow([3, 4])));
    expect(r.gaps).toEqual([]);
    expect(r.pages).toEqual([{ index: 0, number: 1, top: 0, height: 400, kind: "body" }]);
    expect(r.height).toBe(400);
  });

  it("is one empty page for an empty chapter", () => {
    const r = layoutPages(input([], { opensChapter: true }));
    expect(r.pages.map((p) => p.kind)).toEqual(["open"]);
  });

  it("breaks between blocks and sizes the gap so the next page starts on the next card", () => {
    // 15 lines fill a 16 line page but for one line: a 3 line block cannot split (2 lines must stay on each side), so it moves.
    const r = layoutPages(input(flow([15, 3])));
    expect(r.gaps).toHaveLength(1);
    const gap = r.gaps[0]!;
    expect(gap).toMatchObject({ block: 1, linesBefore: 0, blank: false });
    // the rest of the page (400 - 300 used) plus the gap on the canvas
    expect(gap.height).toBe(400 - 300 + 24);
    expect(r.pages[1]!.top).toBe(300 + gap.height);
    expect(r.pages[1]!.top).toBe(400 + 24);
  });

  it("puts a split paragraph's gap at the line it is split at and keeps the cards the page size apart", () => {
    const r = layoutPages(input(flow([30])));
    expect(r.gaps.map((g) => [g.block, g.linesBefore])).toEqual([[0, 16]]);
    const gap = r.gaps[0]!;
    expect(gap.height).toBe(400 - 16 * LH + 24);
    expect(gap.marginTop).toBe(0);
    expect(gap.marginBottom).toBe(0);
    expect(r.pages.map((p) => p.top)).toEqual([0, 400 + 24]);
    expect(r.pages.map((p) => p.number)).toEqual([1, 2]);
  });

  it("cancels the block margins at a break between blocks", () => {
    const blocks: FlowBlock[] = [
      { ...para(0, 15), marginBottom: 6 },
      { ...para(306, 4), marginTop: 9 },
    ];
    const r = layoutPages(input(blocks));
    const gap = r.gaps.find((g) => g.linesBefore === 0)!;
    expect(gap.block).toBe(1);
    expect(gap.marginTop).toBe(-6);
    expect(gap.marginBottom).toBe(-9);
  });

  it("keeps the chapter title's sink on the page by not cancelling its margin", () => {
    const title: FlowBlock = {
      kind: "chapterTitle",
      top: 100,
      height: 40,
      lines: 1,
      lineHeight: 40,
      marginTop: 100,
      marginBottom: 20,
    };
    const body: FlowBlock = { ...para(160, 3) };
    // recto rule on an even first page: a blank verso comes first, and the title's gap keeps its sink
    const r = layoutPages(
      input([title, body], { opensChapter: true, startsOn: "recto", firstPage: 2 }),
    );
    expect(r.gaps[0]).toMatchObject({ block: 0, blank: true, marginTop: 0, marginBottom: 0 });
    expect(r.pages.map((p) => p.kind)).toEqual(["blank", "open"]);
    expect(r.pages.map((p) => p.number)).toEqual([2, 3]);
    // a blank page uses nothing: the gap is a whole page plus the canvas gap
    expect(r.gaps[0]!.height).toBe(400 + 24);
    expect(r.pages[1]!.top).toBe(424);
  });

  it("marks the opening page, and none when the chapter does not open on a new page", () => {
    const opening = layoutPages(input(flow([3]), { opensChapter: true }));
    expect(opening.pages.map((p) => p.kind)).toEqual(["open"]);
    expect(layoutPages(input(flow([3]))).pages.map((p) => p.kind)).toEqual(["body"]);
  });

  it("lets a block taller than a page grow its card and push the next page down", () => {
    const tall: FlowBlock = {
      kind: "image",
      top: 0,
      height: 600,
      lines: 1,
      lineHeight: 600,
      marginTop: 0,
      marginBottom: 0,
    };
    const r = layoutPages(input([tall, para(600, 2)]));
    expect(r.pages[0]!.height).toBe(40 + 600 + 40);
    // the next card starts below the grown card and the canvas gap
    expect(r.pages[1]!.top).toBeGreaterThanOrEqual(r.pages[0]!.height + 24);
  });

  it("keeps every card the page size when the text overruns the text box by the fill slack", () => {
    // 16.8 lines of room: the page holds 336 px of text (320 + 16 slack), more than the 320 px text box
    const blocks = flow([16, 16]);
    const r = layoutPages(input(blocks, { textHeight: 336 }));
    expect(r.pages.map((p) => p.height)).toEqual([400, 400]);
    expect(r.pages[1]!.top).toBe(424);
    // an overrun of the text box is absorbed by the spacer
    expect(r.gaps[0]!.height).toBe(400 + 24 - 320);
  });

  it("makes the stack as tall as the last card ends", () => {
    const r = layoutPages(input(flow([40])));
    const last = r.pages[r.pages.length - 1]!;
    expect(r.height).toBe(last.top + last.height);
  });
});

describe("withTops", () => {
  it("takes the card tops measured in the DOM", () => {
    const r = layoutPages(input(flow([30])));
    const t = withTops(r, [0, 440]);
    expect(t.pages.map((p) => p.top)).toEqual([0, 440]);
    expect(t.height).toBe(440 + 400);
  });
  it("snaps tops that are within a few px of the prediction", () => {
    const r = layoutPages(input(flow([30])));
    expect(withTops(r, [0.4, 425.5]).pages.map((p) => p.top)).toEqual([0, 424]);
  });
  it("keeps the prediction when the count does not match", () => {
    const r = layoutPages(input(flow([30])));
    expect(withTops(r, [0])).toBe(r);
  });
});

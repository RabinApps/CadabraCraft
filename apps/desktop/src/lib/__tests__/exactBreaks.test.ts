import { describe, expect, it } from "vitest";
import type { BlockMarkKind, BlockPages } from "@cadabracraft/export-pdf";
import { exactBreaks, type ExactLeaf, type ExactSource } from "../page/exactBreaks";

/** A unit of the report: leaf `leaf` of block `block`. */
const b = (
  block: number,
  kind: BlockMarkKind,
  page: number,
  splits: [number, number][] = [],
  leaf = 0,
): BlockPages => ({
  block,
  leaf,
  kind,
  page,
  splits: splits.map(([word, p]) => ({ word, page: p })),
});
const src = (blocks: BlockPages[], end = 12, base = 10): ExactSource => ({ base, end, blocks });
/** A leaf of the document, 50 words long unless it says otherwise. */
const l = (kind: BlockMarkKind, words = 50, blank = false): ExactLeaf => ({ kind, blank, words });
/** One list of leaves per top-level block. */
const doc = (...blocks: ExactLeaf[][]) => blocks;

describe("exactBreaks", () => {
  it("is empty when every leaf is on the chapter's first page", () => {
    expect(exactBreaks(src([b(0, "h", 10), b(1, "p", 10)], 10), doc([l("h")], [l("p")]))).toEqual(
      [],
    );
  });

  it("breaks before a block that starts a new page and inside a paragraph that runs onto one", () => {
    const blocks = [
      b(0, "h", 10),
      b(1, "p", 10, [[20, 11]]),
      b(2, "p", 11),
      b(3, "p", 12),
      b(4, "p", 12, [[7, 13]]),
    ];
    expect(
      exactBreaks(src(blocks, 13), doc([l("h")], [l("p")], [l("p")], [l("p")], [l("p")])),
    ).toEqual([
      { block: 1, leaf: 0, word: 20 },
      { block: 3, leaf: 0, word: null },
      { block: 4, leaf: 0, word: 7 },
    ]);
  });

  it("follows a paragraph over several pages", () => {
    const blocks = [
      b(0, "p", 10, [
        [10, 11],
        [30, 12],
      ]),
      b(1, "p", 12),
    ];
    expect(exactBreaks(src(blocks), doc([l("p")], [l("p")]))).toEqual([
      { block: 0, leaf: 0, word: 10 },
      { block: 0, leaf: 0, word: 30 },
    ]);
  });

  it("finds the breaks inside a quote, a list and a table by their leaves", () => {
    // A list of three items: the second starts page 11, the third runs onto page 12 at its word 4.
    const list = [b(1, "p", 10, [], 0), b(1, "p", 11, [], 1), b(1, "p", 11, [[4, 12]], 2)];
    expect(
      exactBreaks(
        src([b(0, "p", 10), ...list, b(2, "i", 12)]),
        doc([l("p")], [l("p"), l("p"), l("p")], [l("i")]),
      ),
    ).toEqual([
      { block: 1, leaf: 1, word: null },
      { block: 1, leaf: 2, word: 4 },
    ]);
    // A heading, a block of code (lines) and a scene break can be placed too.
    const mixed = [b(0, "h", 10, [[1, 11]]), b(1, "k", 11, [[30, 12]]), b(2, "s", 12)];
    expect(exactBreaks(src(mixed), doc([l("h", 3)], [l("k", 40)], [l("s", 0)]))).toEqual([
      { block: 0, leaf: 0, word: 1 },
      { block: 1, leaf: 0, word: 30 },
    ]);
  });

  it("carries the character a page begins at inside a hyphenated word", () => {
    const blocks = [
      {
        ...b(0, "p", 10, [[20, 11]]),
        splits: [{ word: 20, page: 11, char: 5 }],
      },
    ];
    expect(exactBreaks(src(blocks, 11), doc([l("p")]))).toEqual([
      { block: 0, leaf: 0, word: 20, char: 5 },
    ]);
  });

  it("lets blank paragraphs the exporter skips sit anywhere, but nothing else", () => {
    const blocks = [b(0, "p", 10), b(2, "p", 11)];
    expect(exactBreaks(src(blocks, 11), doc([l("p")], [l("p", 0, true)], [l("p")]))).toEqual([
      { block: 2, leaf: 0, word: null },
    ]);
    // A leaf that is not blank must be in the report, and the report may not have more than the document.
    expect(exactBreaks(src(blocks, 11), doc([l("p")], [l("p")], [l("p")]))).toBeNull();
    expect(
      exactBreaks(src(blocks, 11), doc([l("p")], [l("p", 0, true)], [l("p")], [l("p")])),
    ).toBeNull();
    expect(exactBreaks(src(blocks, 11), doc([l("p")]))).toBeNull();
  });

  it("refuses marks for other blocks or leaves than the document has", () => {
    expect(exactBreaks(src([b(0, "p", 10), b(1, "p", 10)], 10), doc([l("p")]))).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10)], 10), doc([l("h")]))).toBeNull();
    expect(exactBreaks(src([b(1, "p", 10)], 10), doc([l("p")]))).toBeNull();
  });

  it("refuses pages that do not follow one another", () => {
    expect(exactBreaks(src([b(0, "p", 11)], 11), doc([l("p")]))).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10), b(1, "p", 8)], 12), doc([l("p")], [l("p")]))).toBeNull();
    expect(
      exactBreaks(src([b(0, "p", 10), b(1, "p", 12)], 12), doc([l("p")], [l("p")])),
    ).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10, [[5, 12]])], 12), doc([l("p")]))).toBeNull();
    // The chapter cannot end before its last block starts.
    expect(
      exactBreaks(src([b(0, "p", 10), b(1, "p", 11)], 10), doc([l("p")], [l("p")])),
    ).toBeNull();
  });

  it("refuses a split at a word the leaf does not have, or out of order, or in a leaf that cannot split", () => {
    const one = (word: number) => src([b(0, "p", 10, [[word, 11]])], 11);
    expect(exactBreaks(one(49), doc([l("p")]))).toEqual([{ block: 0, leaf: 0, word: 49 }]);
    expect(exactBreaks(one(50), doc([l("p")]))).toBeNull();
    expect(exactBreaks(one(0), doc([l("p")]))).toBeNull();
    expect(
      exactBreaks(
        src([
          b(0, "p", 10, [
            [9, 11],
            [9, 12],
          ]),
        ]),
        doc([l("p")]),
      ),
    ).toBeNull();
    for (const kind of ["s", "i"] as const)
      expect(exactBreaks(src([b(0, kind, 10, [[3, 11]])], 11), doc([l(kind)]))).toBeNull();
  });

  it("is empty for a chapter with nothing in it", () => {
    expect(exactBreaks(src([], 10), [])).toEqual([]);
    expect(exactBreaks(src([], 10), doc([l("p", 0, true)]))).toEqual([]);
  });
});

describe("exactBreaks, table rows that Typst splits across pages", () => {
  /** A leaf in cell `cell` of row `row`, 50 words long unless it says otherwise. */
  const c = (row: number, cell: number, words = 50, blank = false): ExactLeaf => ({
    kind: "p",
    blank,
    words,
    cell: { row, cell },
  });
  /** A unit of the report: leaf `leaf` of block 1, a table. */
  const u = (leaf: number, page: number, splits: [number, number][] = []): BlockPages =>
    b(1, "p", page, splits, leaf);
  const before = b(0, "p", 10);

  it("gives a row that ends before the page does no break, however many cells it has", () => {
    // Row 0: two cells; row 1: two cells, the second with two paragraphs. All on page 10.
    const leaves = doc([l("p")], [c(0, 0), c(0, 1), c(1, 0), c(1, 1), c(1, 1)]);
    expect(
      exactBreaks(src([before, u(0, 10), u(1, 10), u(2, 10), u(3, 10), u(4, 10)], 10), leaves),
    ).toEqual([]);
  });

  it("draws a page that begins inside a row as a cut in each cell that runs over, in document order, not in order of the report's pages", () => {
    // Row 0: cell 0 (leaf 0) runs onto page 11 at its word 20, cell 1 has three paragraphs: the first ends on page 10, the second
    // runs onto 11 at its word 7, the third starts on 11 (and the cell ends there).
    const leaves = doc([l("p")], [c(0, 0), c(0, 1, 10), c(0, 1), c(0, 1)]);
    const blocks = [before, u(0, 10, [[20, 11]]), u(1, 10), u(2, 10, [[7, 11]]), u(3, 11)];
    expect(exactBreaks(src(blocks, 11), leaves)).toEqual([
      {
        block: 1,
        leaf: 0,
        word: 20,
        row: 0,
        cuts: [
          { leaf: 0, word: 20 },
          { leaf: 2, word: 7 },
        ],
      },
    ]);
    // A paragraph that starts on the next page at the top of its cell is a cut before it.
    const next = [before, u(0, 10, [[20, 11]]), u(1, 10), u(2, 11)];
    expect(exactBreaks(src(next, 11), doc([l("p")], [c(0, 0), c(0, 1, 10), c(0, 1)]))).toEqual([
      {
        block: 1,
        leaf: 0,
        word: 20,
        row: 0,
        cuts: [
          { leaf: 0, word: 20 },
          { leaf: 2, word: null },
        ],
      },
    ]);
  });

  it("follows a row over several pages, and a cell that ends before the row does", () => {
    // Cell 0 runs onto 11 and 12 (at words 10 and 30), cell 1 only onto 11 (word 4, with a hyphen cut), cell 2 ends on 10.
    const leaves = doc([c(0, 0), c(0, 1), c(0, 2), c(1, 0)]);
    const blocks = [
      {
        ...u(0, 10),
        block: 0,
        splits: [
          { word: 10, page: 11, char: 3 },
          { word: 30, page: 12 },
        ],
      },
      { ...u(1, 10), block: 0, splits: [{ word: 4, page: 11, char: 2 }] },
      { ...u(2, 10), block: 0 },
      { ...u(3, 12), block: 0 },
    ];
    expect(exactBreaks(src(blocks, 12), leaves)).toEqual([
      {
        block: 0,
        leaf: 0,
        word: 10,
        char: 3,
        row: 0,
        cuts: [
          { leaf: 0, word: 10, char: 3 },
          { leaf: 1, word: 4, char: 2 },
        ],
      },
      { block: 0, leaf: 0, word: 30, row: 0, cuts: [{ leaf: 0, word: 30 }] },
    ]);
  });

  it("breaks before a row that starts a page, also when its first cell has no text, and carries on from the page it ends on", () => {
    // Row 0 (one cell, runs onto page 11 at its word 5); row 1 starts page 12 (cell 0 is blank, its text is in cell 1); row 2 on 12.
    const leaves = doc([c(0, 0), c(1, 0, 0, true), c(1, 1), c(2, 0)]);
    const blocks = [
      { ...u(0, 10, [[5, 11]]), block: 0 },
      { ...u(2, 12), block: 0 },
      { ...u(3, 12), block: 0 },
    ];
    expect(exactBreaks(src(blocks, 12), leaves)).toEqual([
      { block: 0, leaf: 0, word: 5, row: 0, cuts: [{ leaf: 0, word: 5 }] },
      { block: 0, leaf: 2, word: null, rowStart: true },
    ]);
    // A row of blank cells has no marks and no breaks.
    expect(exactBreaks(src([b(0, "p", 10)], 10), doc([l("p")], [c(0, 0, 0, true)]))).toEqual([]);
  });

  it("refuses what Typst does not do: a cell that starts after the row, a cell that skips a page, a page that no cell begins, a row that moves back", () => {
    const row = doc([l("p")], [c(0, 0), c(0, 1)]);
    // The second cell's first paragraph is on the next page.
    expect(exactBreaks(src([before, u(0, 10), u(1, 11)], 11), row)).toBeNull();
    // A cell that runs two pages on at once.
    expect(exactBreaks(src([before, u(0, 10, [[5, 12]]), u(1, 10)], 12), row)).toBeNull();
    // A later paragraph of a cell that is on a page before the one the cell reached.
    expect(
      exactBreaks(
        src([before, u(0, 10, [[5, 11]]), u(1, 10), u(2, 10)], 11),
        doc([l("p")], [c(0, 0), c(0, 1, 50), c(0, 0)]),
      ),
    ).toBeNull();
    // The row starts two pages on, or the wrong block, kind or end.
    expect(exactBreaks(src([before, u(0, 12), u(1, 12)], 12), row)).toBeNull();
    expect(exactBreaks(src([before, u(0, 10)], 10), row)).toBeNull();
    expect(exactBreaks(src([before, { ...u(0, 10), kind: "h" }, u(1, 10)], 10), row)).toBeNull();
    // A leaf that cannot split cannot split in a cell either.
    expect(
      exactBreaks(
        src([before, { ...u(0, 10, [[1, 11]]), kind: "s" }, u(1, 10)], 11),
        doc([l("p")], [{ kind: "s", blank: false, words: 0, cell: { row: 0, cell: 0 } }, c(0, 1)]),
      ),
    ).toBeNull();
    // A split at a word the paragraph does not have, or out of order.
    expect(exactBreaks(src([before, u(0, 10, [[50, 11]]), u(1, 10)], 11), row)).toBeNull();
    expect(
      exactBreaks(
        src(
          [
            before,
            u(0, 10, [
              [9, 11],
              [9, 12],
            ]),
            u(1, 10),
          ],
          12,
        ),
        row,
      ),
    ).toBeNull();
    // The report may not have less than the document.
    expect(exactBreaks(src([before], 10), doc([l("p")], [c(0, 0)]))).toBeNull();
    // The report may not have more than the document.
    expect(exactBreaks(src([before, u(0, 10), u(1, 10)], 10), doc([l("p")], [c(0, 0)]))).toBeNull();
  });

  it("starts the chapter with a table", () => {
    expect(exactBreaks(src([{ ...u(0, 11), block: 0 }], 11), doc([c(0, 0)]))).toBeNull();
    expect(exactBreaks(src([{ ...u(0, 10), block: 0 }], 10), doc([c(0, 0)]))).toEqual([]);
  });
});

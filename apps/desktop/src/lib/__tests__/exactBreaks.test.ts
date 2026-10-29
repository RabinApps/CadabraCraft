import { describe, expect, it } from "vitest";
import type { BlockMarkKind, BlockPages } from "@cadabracraft/export-pdf";
import { exactBreaks, type ExactLeaf, type ExactSource } from "../exactBreaks";

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

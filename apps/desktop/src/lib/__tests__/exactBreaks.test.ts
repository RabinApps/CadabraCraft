import { describe, expect, it } from "vitest";
import type { BlockMarkKind, BlockPages } from "@cadabracraft/export-pdf";
import { exactBreaks, type ExactSource } from "../exactBreaks";

const b = (
  block: number,
  kind: BlockMarkKind,
  page: number,
  splits: [number, number][] = [],
): BlockPages => ({
  block,
  kind,
  page,
  splits: splits.map(([word, p]) => ({ word, page: p })),
});
const src = (blocks: BlockPages[], end = 12, base = 10): ExactSource => ({ base, end, blocks });
const words = () => 50;

describe("exactBreaks", () => {
  it("is empty when every block is on the chapter's first page", () => {
    expect(exactBreaks(src([b(0, "h", 10), b(1, "p", 10)], 10), ["h", "p"], words)).toEqual([]);
  });

  it("breaks before a block that starts a new page and inside a paragraph that runs onto one", () => {
    const blocks = [
      b(0, "h", 10),
      b(1, "p", 10, [[20, 11]]),
      b(2, "p", 11),
      b(3, "p", 12),
      b(4, "p", 12, [[7, 13]]),
    ];
    expect(exactBreaks(src(blocks, 13), ["h", "p", "p", "p", "p"], words)).toEqual([
      { block: 1, word: 20 },
      { block: 3, word: null },
      { block: 4, word: 7 },
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
    expect(exactBreaks(src(blocks), ["p", "p"], words)).toEqual([
      { block: 0, word: 10 },
      { block: 0, word: 30 },
    ]);
  });

  it("lets blank paragraphs the report skipped sit anywhere, but nothing else", () => {
    const blocks = [b(0, "p", 10), b(2, "p", 11)];
    expect(exactBreaks(src(blocks, 11), ["p", "p", "p"], words)).toEqual([
      { block: 2, word: null },
    ]);
    expect(exactBreaks(src(blocks, 11), ["p", "o", "p"], words)).toBeNull();
    expect(exactBreaks(src(blocks, 11), ["p", "p", "p", "o"], words)).toBeNull();
  });

  it("refuses marks for other blocks than the document has", () => {
    expect(exactBreaks(src([b(0, "p", 10), b(1, "p", 10)], 10), ["p"], words)).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10)], 10), ["h"], words)).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10)], 10), ["q"], words)).toBeNull();
  });

  it("refuses pages that do not follow one another", () => {
    expect(exactBreaks(src([b(0, "p", 11)], 11), ["p"], words)).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10), b(1, "p", 8)], 12), ["p", "p"], words)).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10), b(1, "p", 12)], 12), ["p", "p"], words)).toBeNull();
    expect(exactBreaks(src([b(0, "p", 10, [[5, 12]])], 12), ["p"], words)).toBeNull();
    // The chapter cannot end before its last block starts.
    expect(exactBreaks(src([b(0, "p", 10), b(1, "p", 11)], 10), ["p", "p"], words)).toBeNull();
  });

  it("refuses a split at a word the paragraph does not have, or out of order, or in a block that cannot split", () => {
    const one = (word: number) => src([b(0, "p", 10, [[word, 11]])], 11);
    expect(exactBreaks(one(49), ["p"], words)).toEqual([{ block: 0, word: 49 }]);
    expect(exactBreaks(one(50), ["p"], words)).toBeNull();
    expect(exactBreaks(one(0), ["p"], words)).toBeNull();
    expect(
      exactBreaks(
        src([
          b(0, "p", 10, [
            [9, 11],
            [9, 12],
          ]),
        ]),
        ["p"],
        words,
      ),
    ).toBeNull();
    expect(exactBreaks(src([b(0, "o", 10, [[3, 11]])], 11), ["o"], words)).toBeNull();
  });

  it("only trusts a block it cannot see the end of when the next block starts on the same page", () => {
    // A quote, a list, a heading or a paragraph with a footnote followed by a later page might run onto it.
    for (const kind of ["o", "q", "h"] as const) {
      expect(exactBreaks(src([b(0, kind, 10), b(1, "p", 10)], 10), [kind, "p"], words)).toEqual([]);
      expect(exactBreaks(src([b(0, kind, 10), b(1, "p", 11)], 11), [kind, "p"], words)).toBeNull();
      expect(exactBreaks(src([b(0, "p", 10), b(1, kind, 10)], 11), ["p", kind], words)).toBeNull();
      expect(exactBreaks(src([b(0, "p", 10), b(1, kind, 10)], 10), ["p", kind], words)).toEqual([]);
    }
    // A scene break is one line and an ordinary paragraph says where it runs onto the next page.
    expect(exactBreaks(src([b(0, "s", 10), b(1, "p", 11)], 11), ["s", "p"], words)).toEqual([
      { block: 1, word: null },
    ]);
  });

  it("is empty for a chapter with nothing in it", () => {
    expect(exactBreaks(src([], 10), [], words)).toEqual([]);
    expect(exactBreaks(src([], 10), ["p"], words)).toEqual([]);
  });
});

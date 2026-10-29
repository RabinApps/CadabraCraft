import { describe, expect, it } from "vitest";
import type { PageReport } from "@cadabracraft/export-pdf";
import { pageTarget } from "../previewTarget";

const start = (id: string, page: number, end: number) => ({
  id,
  kind: "chapter",
  page,
  end,
  number: "",
});
const report: PageReport = {
  total: 12,
  starts: [start("front", 3, 3), start("c1", 5, 7), start("c2", 9, 12)],
  blocks: {
    c1: [
      { block: 0, leaf: 0, kind: "h", page: 5, splits: [] },
      { block: 1, leaf: 0, kind: "p", page: 5, splits: [{ word: 40, page: 6 }] },
      { block: 2, leaf: 0, kind: "p", page: 6, splits: [{ word: 12, page: 7 }] },
    ],
    c2: [{ block: 0, leaf: 0, kind: "i", page: 9, splits: [] }],
  },
};

describe("pageTarget", () => {
  it("is the first block that starts on the page, or the word a paragraph runs onto it at", () => {
    expect(pageTarget(report, 5)).toEqual({ id: "c1", block: 0, leaf: 0, word: null });
    expect(pageTarget(report, 6)).toEqual({ id: "c1", block: 1, leaf: 0, word: 40 });
    expect(pageTarget(report, 7)).toEqual({ id: "c1", block: 2, leaf: 0, word: 12 });
  });

  it("is the block the page is inside of when nothing starts on it", () => {
    expect(pageTarget(report, 11)).toEqual({ id: "c2", block: 0, leaf: 0, word: null });
  });

  it("is the entry's start when the report has no marks for it", () => {
    expect(pageTarget(report, 3)).toEqual({ id: "front", block: 0, leaf: 0, word: null });
  });

  it("gives the entry after a page no entry owns (cover, blank verso), and the last one past the end", () => {
    expect(pageTarget(report, 1)).toEqual({ id: "front", block: 0, leaf: 0, word: null });
    expect(pageTarget(report, 8)).toEqual({ id: "c2", block: 0, leaf: 0, word: null });
    expect(pageTarget(report, 4)).toEqual({ id: "c1", block: 0, leaf: 0, word: null });
    expect(pageTarget(report, 99)).toEqual({ id: "c2", block: 0, leaf: 0, word: null });
  });

  it("names the leaf of a quote, list or table that starts the page, or that a word runs onto it", () => {
    const nested: PageReport = {
      total: 3,
      starts: [start("c", 1, 3)],
      blocks: {
        c: [
          { block: 0, leaf: 0, kind: "p", page: 1, splits: [] },
          { block: 1, leaf: 0, kind: "p", page: 1, splits: [] },
          { block: 1, leaf: 1, kind: "p", page: 2, splits: [{ word: 4, page: 3 }] },
        ],
      },
    };
    expect(pageTarget(nested, 2)).toEqual({ id: "c", block: 1, leaf: 1, word: null });
    expect(pageTarget(nested, 3)).toEqual({ id: "c", block: 1, leaf: 1, word: 4 });
  });

  it("says how far into a hyphenated word the page begins", () => {
    const hyphenated: PageReport = {
      total: 2,
      starts: [start("c", 1, 2)],
      blocks: {
        c: [{ block: 0, leaf: 0, kind: "p", page: 1, splits: [{ word: 7, page: 2, char: 4 }] }],
      },
    };
    expect(pageTarget(hyphenated, 2)).toEqual({ id: "c", block: 0, leaf: 0, word: 7, char: 4 });
  });

  it("has no target for a book without entries", () => {
    expect(pageTarget({ total: 0, starts: [] }, 1)).toBeNull();
  });
});

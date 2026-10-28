import { describe, expect, it } from "vitest";
import {
  bookPageCount,
  bookWordsPerPage,
  chapterPageCount,
  chapterStart,
  firstPageNumber,
} from "../pageNumbering";

describe("measured pages and book totals", () => {
  const book = { template: "modern" };

  it("replaces a chapter's estimate with its measured count", () => {
    expect(firstPageNumber(book, [0, 0, 0], new Map([[1, 5]]))).toBe(1 + 1 + 5 + 1);
  });

  it("counts a book's pages with the recto skips, and none for no chapters", () => {
    expect(bookPageCount({ template: "novel" }, [0, 0])).toEqual({ pages: 3, exact: false });
    expect(bookPageCount(book, [0, 0])).toEqual({ pages: 2, exact: false });
    expect(bookPageCount(book, [])).toEqual({ pages: 0, exact: false });
  });

  it("is exact only when every chapter is measured", () => {
    expect(bookPageCount(book, [10, 10], new Map([[0, 4]])).exact).toBe(false);
    const both = new Map([
      [0, 4],
      [1, 3],
    ]);
    expect(bookPageCount(book, [10, 10], both)).toEqual({ pages: 7, exact: true });
  });

  it("gives a words-per-page and a one-page minimum per chapter", () => {
    expect(bookWordsPerPage(book)).toBeGreaterThanOrEqual(50);
    expect(chapterPageCount(0, 250)).toBe(1);
    expect(chapterPageCount(251, 250)).toBe(2);
  });
});

describe("firstPageNumber", () => {
  it("is page 1 for the first chapter", () => {
    expect(firstPageNumber({ template: "novel" }, [])).toBe(1);
  });

  it("counts earlier chapters from the word estimate and keeps recto starts on odd pages", () => {
    const book = { template: "novel" };
    expect(chapterStart(book)).toBe("recto");
    const n = firstPageNumber(book, [3000, 100, 5000]);
    expect(n % 2).toBe(1);
    expect(n).toBeGreaterThan(10);
    // More words before never moves a chapter earlier.
    expect(firstPageNumber(book, [3000, 100, 9000])).toBeGreaterThanOrEqual(n);
  });

  it("gives an empty chapter one page, and falls back for an unknown template", () => {
    expect(firstPageNumber({ template: "novel" }, [0])).toBe(2);
    expect(firstPageNumber({ template: "gone" }, [0, 0])).toBe(
      firstPageNumber({ template: "novel" }, [0, 0]),
    );
  });

  it("does not skip a page where chapters may start anywhere", () => {
    expect(chapterStart({ template: "modern" })).toBe("any");
    expect(firstPageNumber({ template: "modern" }, [0, 0, 0])).toBe(4);
  });
});

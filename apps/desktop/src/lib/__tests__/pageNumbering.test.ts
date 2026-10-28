import { describe, expect, it } from "vitest";
import { chapterStart, firstPageNumber } from "../pageNumbering";

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

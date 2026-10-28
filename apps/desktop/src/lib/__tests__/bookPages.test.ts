import { describe, expect, it } from "vitest";
import { bookPages } from "../bookPages";
import { firstPageNumber } from "../pageNumbering";

describe("bookPages", () => {
  const manifest = { template: "novel" };

  it("agrees with Page view's numbering: the next chapter would start after the last page", () => {
    const words = [3000, 100, 5000];
    expect(bookPages(manifest, words).pages).toBe(firstPageNumber(manifest, words) - 1);
  });

  it("uses a measured count and drops the approximation only when all chapters are measured", () => {
    expect(bookPages(manifest, [3000]).exact).toBe(false);
    expect(bookPages(manifest, [3000], new Map([[0, 99]]))).toMatchObject({
      pages: 99,
      exact: true,
    });
    expect(bookPages(manifest, [3000, 10], new Map([[0, 99]])).exact).toBe(false);
  });

  it("reports the trim size", () => {
    expect(bookPages({ template: "novel", trimSize: "6x9" }, [1]).trimSize).toBe("6x9");
  });
});

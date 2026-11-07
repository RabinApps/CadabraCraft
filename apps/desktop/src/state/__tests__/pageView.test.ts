import { describe, expect, it } from "vitest";
import { pageViewAvailable, readingPaged } from "../view/pageView";

describe("page surface availability", () => {
  it("is the paged book only in Write mode at md+ width (a phone reflows)", () => {
    expect(pageViewAvailable("write", true)).toBe(true);
    expect(pageViewAvailable("write", false)).toBe(false);
    expect(pageViewAvailable("read", true)).toBe(false);
    expect(pageViewAvailable("read", false)).toBe(false);
  });
});

describe("Read mode page format", () => {
  it("draws pages in Read mode on windows at least md wide", () => {
    expect(readingPaged("read", true)).toBe(true);
    expect(readingPaged("read", false)).toBe(false);
    expect(readingPaged("write", true)).toBe(false);
    expect(readingPaged("write", false)).toBe(false);
  });
});

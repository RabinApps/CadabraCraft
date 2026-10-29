import { describe, expect, it } from "vitest";
import { pageViewAvailable, pageViewOn, readingPaged } from "../pageView";

describe("Page view availability", () => {
  it("is offered only in Write mode at md+ width", () => {
    expect(pageViewAvailable("write", true)).toBe(true);
    expect(pageViewAvailable("write", false)).toBe(false);
    expect(pageViewAvailable("read", true)).toBe(false);
    expect(pageViewAvailable("read", false)).toBe(false);
  });
  it("is on only when wanted and offered", () => {
    expect(pageViewOn(true, "write", true)).toBe(true);
    expect(pageViewOn(false, "write", true)).toBe(false);
    expect(pageViewOn(true, "write", false)).toBe(false);
    expect(pageViewOn(true, "read", true)).toBe(false);
  });
});

describe("Read mode page format", () => {
  it("draws pages in Read mode on windows at least md wide, whatever the Page view preference", () => {
    expect(readingPaged("read", true)).toBe(true);
    expect(readingPaged("read", false)).toBe(false);
    expect(readingPaged("write", true)).toBe(false);
    expect(readingPaged("write", false)).toBe(false);
  });
});

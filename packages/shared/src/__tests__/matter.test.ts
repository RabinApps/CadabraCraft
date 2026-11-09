import { describe, expect, it } from "vitest";
import { isBackMatterKind, isFrontMatterKind, isPartKind } from "../matter";

describe("matter kind guards", () => {
  it("recognises front and back matter kinds, and nothing else", () => {
    expect(isFrontMatterKind("dedication")).toBe(true);
    expect(isFrontMatterKind("acknowledgments")).toBe(false);
    expect(isBackMatterKind("colophon")).toBe(true);
    expect(isBackMatterKind("dedication")).toBe(false);
    expect(isFrontMatterKind(undefined)).toBe(false);
    expect(isBackMatterKind(42)).toBe(false);
  });
  it("recognises the part divider only", () => {
    expect(isPartKind("part")).toBe(true);
    expect(isPartKind("contents")).toBe(false);
    expect(isPartKind(null)).toBe(false);
  });
});

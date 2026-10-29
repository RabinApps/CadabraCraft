import { describe, expect, it } from "vitest";
import { fuzzyMatch, highlightSegments, rank } from "../fuzzy";

describe("fuzzyMatch", () => {
  it("matches letters in order, ignoring case and spaces in the query", () => {
    // The "pdf" is taken from the word PDF, where the letters are together, not from "Print".
    expect(fuzzyMatch("EXP pdf", "Export Print PDF")?.positions).toEqual([0, 1, 2, 13, 14, 15]);
    expect(fuzzyMatch("bld", "Bold")?.positions).toEqual([0, 2, 3]);
  });

  it("returns null when a letter is missing or the order is wrong", () => {
    expect(fuzzyMatch("xyz", "Export")).toBeNull();
    expect(fuzzyMatch("tx", "Export")).toBeNull();
    expect(fuzzyMatch("bb", "Bold")).toBeNull();
    expect(fuzzyMatch("a", "")).toBeNull();
  });

  it("matches everything with nothing highlighted for an empty query", () => {
    expect(fuzzyMatch("", "Anything")).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch("  ", "Anything")).toEqual({ score: 0, positions: [] });
  });

  it("prefers consecutive letters and word starts over scattered ones", () => {
    const tight = fuzzyMatch("pre", "Preview")!;
    const loose = fuzzyMatch("pre", "Print Preferences with e")!;
    expect(tight.score).toBeGreaterThan(loose.score);
    const wordStart = fuzzyMatch("pp", "Print Preview")!;
    expect(wordStart.positions).toEqual([0, 6]);
  });

  it("picks the best of several places to start", () => {
    // "ab" appears scattered first ("a..b") and together later ("ab").
    const m = fuzzyMatch("ab", "a   b ab")!;
    expect(m.positions).toEqual([6, 7]);
  });

  it("charges for big gaps only up to a limit", () => {
    const near = fuzzyMatch("ae", "a-e")!;
    const farther = fuzzyMatch("ae", "a-------e")!;
    const farthest = fuzzyMatch("ae", "a----------e")!;
    expect(near.score).toBeGreaterThan(farther.score);
    // Beyond 5 skipped letters the gap costs no more (only the text length does).
    expect(farther.score - farthest.score).toBeCloseTo(0.03, 5);
  });

  it("works on text outside ASCII and outside the Basic Multilingual Plane", () => {
    expect(fuzzyMatch("שלו", "שלום עולם")?.positions).toEqual([0, 1, 2]);
    expect(fuzzyMatch("ب", "كتاب")?.positions).toEqual([3]);
    // Code point indexes: the emoji counts as one.
    expect(fuzzyMatch("b", "😀 b")?.positions).toEqual([2]);
    expect(fuzzyMatch("i", "İstanbul")).toBeNull();
  });
});

describe("rank", () => {
  const items = [
    { label: "Open folder", group: "File" },
    { label: "EPUB…", group: "File · Export" },
    { label: "Bold", group: "Format" },
    { label: "Bold italic", group: "Format" },
  ];
  const labelOf = (i: (typeof items)[number]) => i.label;
  const groupOf = (i: (typeof items)[number]) => i.group;

  it("keeps everything in input order for an empty query", () => {
    expect(rank(items, "", labelOf).map((r) => r.item.label)).toEqual(items.map((i) => i.label));
  });

  it("puts the better match first and breaks ties by input order", () => {
    expect(rank(items, "bold", labelOf).map((r) => r.item.label)).toEqual(["Bold", "Bold italic"]);
    expect(rank(items, "o", labelOf).map((r) => r.item.label)).toEqual([
      "Open folder",
      "Bold",
      "Bold italic",
    ]);
  });

  it("falls back to the secondary text and highlights only the label", () => {
    const hit = rank(items, "exportepub", labelOf, groupOf);
    expect(hit.map((r) => r.item.label)).toEqual(["EPUB…"]);
    expect(hit[0]!.positions).toEqual([0, 1, 2, 3]);
    // The secondary text is optional.
    expect(rank(items, "exportepub", labelOf)).toEqual([]);
  });

  it("ranks a label match above a match that needs the secondary text", () => {
    const list = [
      { label: "Settings", group: "Format Bold" },
      { label: "Bold", group: "Format" },
    ];
    const r = rank(list, "bold", labelOf, groupOf);
    expect(r.map((x) => x.item.label)).toEqual(["Bold", "Settings"]);
    expect(r[1]!.positions).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("splits the text into matched and unmatched runs", () => {
    expect(highlightSegments("Export", [0, 1, 4])).toEqual([
      { text: "Ex", hit: true },
      { text: "po", hit: false },
      { text: "r", hit: true },
      { text: "t", hit: false },
    ]);
  });

  it("returns one run when nothing matches, none for empty text, and joins back to the text", () => {
    expect(highlightSegments("Bold", [])).toEqual([{ text: "Bold", hit: false }]);
    expect(highlightSegments("", [])).toEqual([]);
    const segments = highlightSegments("😀 ab", [0, 3]);
    expect(segments.map((s) => s.text).join("")).toBe("😀 ab");
    expect(segments[0]).toEqual({ text: "😀", hit: true });
  });
});

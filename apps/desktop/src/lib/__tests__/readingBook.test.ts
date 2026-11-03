import { describe, expect, it } from "vitest";
import { sizes } from "../../state/reading";
import {
  PLAIN_PAD_PX,
  READING_ZOOM_STEPS,
  chainFirstPages,
  pageAtLine,
  pagedHeight,
  plainHeight,
  readingGutter,
  readingZoom,
  visibleIndex,
  type ChainEntry,
} from "../readingBook";

const chapter = (id: string, estimate: number, measured: number | null = null): ChainEntry => ({
  id,
  section: "chapter",
  measured,
  estimate,
});
const matter = (id: string, section: "front" | "back"): ChainEntry => ({
  id,
  section,
  measured: null,
  estimate: 1,
});

describe("chainFirstPages", () => {
  it("starts each chapter after the previous one's estimated pages", () => {
    const first = chainFirstPages([chapter("a", 3), chapter("b", 2), chapter("c", 1)], "any");
    expect([...first]).toEqual([
      ["a", 1],
      ["b", 4],
      ["c", 6],
    ]);
  });

  it("uses a chapter's laid-out count over its estimate", () => {
    const first = chainFirstPages([chapter("a", 3, 5), chapter("b", 2)], "any");
    expect(first.get("b")).toBe(6);
  });

  it("gives an even start a blank verso where chapters open on the right, and counts it", () => {
    // a: 1-2, b would start on 3 (odd): no blank; b: 3-5 (3 pages), c would start on 6 (even): blank first.
    const first = chainFirstPages(
      [chapter("a", 2), chapter("b", 3), chapter("c", 1), chapter("d", 1)],
      "recto",
    );
    expect(first.get("b")).toBe(3);
    expect(first.get("c")).toBe(6);
    // c takes its blank page 6 and opens on 7; d starts after 7 on 8: a blank again.
    expect(first.get("d")).toBe(8);
  });

  it("counts a measured chapter's own blank page, not another one", () => {
    // c measured as 2 pages including its blank (6, 7): d starts on 8.
    const first = chainFirstPages(
      [chapter("a", 2), chapter("b", 3), chapter("c", 1, 2), chapter("d", 1)],
      "recto",
    );
    expect(first.get("d")).toBe(8);
  });

  it("numbers front and back matter from 1 and leaves the chain alone", () => {
    const first = chainFirstPages(
      [matter("f", "front"), chapter("a", 2), matter("z", "back"), chapter("b", 1)],
      "any",
    );
    expect([...first]).toEqual([
      ["f", 1],
      ["a", 1],
      ["z", 1],
      ["b", 3],
    ]);
  });

  it("takes Typst's printed number, drawing the blank page before it when the chain is one short", () => {
    const typst = (id: string) => ({ a: 1, b: 5 })[id as "a" | "b"] ?? null;
    // a is 3 pages (1-3); the chain says b starts on 4, Typst says 5: the blank verso 4 is drawn first.
    const first = chainFirstPages([chapter("a", 3), chapter("b", 1)], "recto", typst);
    expect(first.get("b")).toBe(4);
    // Typst's number matches the chain: nothing extra.
    const same = chainFirstPages([chapter("a", 4), chapter("b", 1)], "recto", typst);
    expect(same.get("b")).toBe(5);
  });

  it("takes Typst's number as it is where chapters do not open on the right", () => {
    const first = chainFirstPages([chapter("a", 3), chapter("b", 1)], "any", (id) =>
      id === "b" ? 6 : null,
    );
    expect(first.get("b")).toBe(6);
  });

  it("is empty for no entries", () => {
    expect(chainFirstPages([], "recto").size).toBe(0);
  });
});

describe("placeholder heights", () => {
  it("is pages x (page + gap) at the zoom, less the trailing gap", () => {
    expect(pagedHeight(3, 800, 24, 1)).toBe(3 * 824 - 24);
    expect(pagedHeight(3, 800, 24, 0.5)).toBe(Math.round((3 * 824 - 24) / 2));
    expect(pagedHeight(0, 800, 24, 1)).toBe(800);
  });

  it("grows with words and text size and shrinks with a wider column", () => {
    const base = plainHeight(1000, 1.3125, 500);
    expect(plainHeight(2000, 1.3125, 500)).toBeGreaterThan(base);
    expect(plainHeight(1000, 1.5625, 500)).toBeGreaterThan(base);
    expect(plainHeight(1000, 1.3125, 700)).toBeLessThan(base);
    expect(plainHeight(0, 1.3125, 500)).toBe(PLAIN_PAD_PX);
  });

  it("copes with a column narrower than a line", () => {
    expect(plainHeight(10, 1.3125, 0)).toBeGreaterThan(PLAIN_PAD_PX);
  });
});

describe("the reading line", () => {
  it("picks the last section at or above the line, the first when above all", () => {
    expect(visibleIndex([0, 500, 1200], 100, false)).toBe(0);
    expect(visibleIndex([0, 500, 1200], 500, false)).toBe(1);
    expect(visibleIndex([0, 500, 1200], 5000, false)).toBe(2);
    expect(visibleIndex([40, 500], 10, false)).toBe(0);
  });

  it("picks the last section at the end of the scroll, and none for no sections", () => {
    expect(visibleIndex([0, 500, 1200], 100, true)).toBe(2);
    expect(visibleIndex([], 100, false)).toBe(-1);
  });

  it("finds the page the line is on", () => {
    const cards = [
      { top: -900, number: 7 },
      { top: -40, number: 8 },
      { top: 860, number: 9 },
    ];
    expect(pageAtLine(cards, 200)).toBe(8);
    expect(pageAtLine(cards, 900)).toBe(9);
    expect(pageAtLine(cards, -2000)).toBeNull();
    expect(pageAtLine([], 0)).toBeNull();
  });
});

describe("reading zoom", () => {
  it("has a step for every text size, the middle one fitting the width", () => {
    expect(READING_ZOOM_STEPS).toHaveLength(sizes.length);
    expect(READING_ZOOM_STEPS[2]).toBe(1);
    expect(readingZoom(0.8, 2)).toBeCloseTo(0.8);
  });

  it("is larger for larger sizes and stays within 0.3 to 2", () => {
    expect(readingZoom(1, 4)).toBeGreaterThan(readingZoom(1, 0));
    expect(readingZoom(0.31, 0)).toBe(0.3);
    expect(readingZoom(2, 4)).toBe(2);
    expect(readingZoom(1, 99)).toBe(1);
  });

  it("starts from the chosen page zoom instead of the fit when one is given", () => {
    expect(readingZoom(0.8, 2, "fit")).toBeCloseTo(0.8);
    expect(readingZoom(0.8, 2, 1)).toBeCloseTo(1);
    expect(readingZoom(0.8, 2, 0.75)).toBeCloseTo(0.75);
    expect(readingZoom(0.8, 4, 1)).toBeCloseTo(1.25); // the text size still scales it
    expect(readingZoom(0.8, 4, 1.25)).toBeCloseTo(1.5625);
    expect(readingZoom(0.8, 0, 0.75)).toBeCloseTo(0.6);
  });

  it("leaves a smaller gutter for the wide setting", () => {
    expect(readingGutter("wide")).toBeLessThan(readingGutter("narrow"));
  });
});

import { describe, expect, it } from "vitest";
import { sizes } from "../../state/view/reading";
import {
  PLAIN_PAD_PX,
  READING_ZOOM_STEPS,
  pageAtLine,
  pagedHeight,
  plainHeight,
  readingGutter,
  readingZoom,
  visibleIndex,
} from "../reading/readingBook";

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

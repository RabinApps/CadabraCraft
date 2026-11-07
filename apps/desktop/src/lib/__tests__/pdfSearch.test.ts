import { describe, expect, it } from "vitest";
import { countsByPage, findMatches, toScreen, type PdfTextItem } from "../export/pdfSearch";

const item = (str: string, x = 0, width = str.length * 10): PdfTextItem => ({
  str,
  x,
  y: 20,
  width,
  height: 10,
});

describe("findMatches", () => {
  const pages = [
    [item("Storm on the  third")],
    [item("Calm seas, ", 0, 110), item("storm warning", 110, 130)],
    [item("Another STORM and storm")],
  ];
  it("finds every match with its page, ignoring case and spacing", () => {
    expect(findMatches(pages, "storm").map((m) => m.page)).toEqual([1, 2, 3, 3]);
    expect(findMatches(pages, "the third").map((m) => m.page)).toEqual([1]);
    expect(findMatches(pages, "  calm  ").map((m) => m.page)).toEqual([2]);
  });
  it("sizes the box to the matched characters of the item", () => {
    const [m] = findMatches([[item("a storm", 100, 70)]], "storm");
    expect(m!.rects).toEqual([{ x: 120, y: 20, width: 50, height: 10 }]);
  });
  it("gives one box per item when a match spans items", () => {
    const m = findMatches(pages, "seas, storm")[0]!;
    expect(m.rects.map((r) => r.x)).toEqual([50, 110]);
    expect(m.rects[1]!.width).toBeCloseTo(50);
  });
  it("skips empty items and items without width", () => {
    expect(findMatches([[item(""), item("storm", 0, 0)]], "storm")).toEqual([]);
    expect(findMatches([[item("a"), item(" "), item("b")]], "a b")).toHaveLength(1);
  });
  it("finds nothing for text that is not there or an empty query", () => {
    expect(findMatches(pages, "gale")).toEqual([]);
    expect(findMatches(pages, "   ")).toEqual([]);
    expect(findMatches([], "storm")).toEqual([]);
  });
});

describe("countsByPage", () => {
  it("counts the matches of each page", () => {
    const m = findMatches([[item("a a")], [item("b")], [item("a")]], "a");
    expect([...countsByPage(m)]).toEqual([
      [1, 2],
      [3, 1],
    ]);
  });
});

describe("toScreen", () => {
  it("flips and scales a PDF rectangle (scale 2, page 100 high)", () => {
    expect(toScreen({ x: 10, y: 20, width: 30, height: 10 }, [2, 0, 0, -2, 0, 200])).toEqual({
      left: 20,
      top: 140,
      width: 60,
      height: 20,
    });
  });
});

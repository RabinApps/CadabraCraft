import { describe, expect, it } from "vitest";
import { spreadCount, spreadLabel, spreadPages } from "../export/previewSpreads";

describe("previewSpreads", () => {
  it("counts the spreads: the first page alone, then pairs", () => {
    expect([0, 1, 2, 3, 4, 5].map(spreadCount)).toEqual([0, 1, 2, 2, 3, 3]);
  });
  it("pairs the pages as a book opens", () => {
    expect(spreadPages(0, 5)).toEqual([null, 1]);
    expect(spreadPages(1, 5)).toEqual([2, 3]);
    expect(spreadPages(2, 5)).toEqual([4, 5]);
  });
  it("leaves the right side empty after an even last page", () => {
    expect(spreadPages(2, 4)).toEqual([4, null]);
  });
  it("clamps the index into range and has nothing for an empty PDF", () => {
    expect(spreadPages(-3, 5)).toEqual([null, 1]);
    expect(spreadPages(99, 5)).toEqual([4, 5]);
    expect(spreadPages(0, 0)).toEqual([null, null]);
  });
  it("lists the pages a spread shows", () => {
    expect(spreadLabel([null, 1])).toEqual([1]);
    expect(spreadLabel([4, 5])).toEqual([4, 5]);
    expect(spreadLabel([4, null])).toEqual([4]);
  });
});

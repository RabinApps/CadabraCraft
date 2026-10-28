import { describe, expect, it } from "vitest";
import { matchPages } from "../pdfSearch";

describe("matchPages", () => {
  const pages = ["Storm on the  third", "Calm seas", "Another STORM warning"];
  it("lists the pages that contain the text, ignoring case and spacing", () => {
    expect(matchPages(pages, "storm")).toEqual([1, 3]);
    expect(matchPages(pages, "the third")).toEqual([1]);
    expect(matchPages(pages, "  calm  ")).toEqual([2]);
  });
  it("finds nothing for text that is not there or an empty query", () => {
    expect(matchPages(pages, "gale")).toEqual([]);
    expect(matchPages(pages, "   ")).toEqual([]);
    expect(matchPages([], "storm")).toEqual([]);
  });
});

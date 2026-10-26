import { describe, expect, it } from "vitest";
import { createManifest, type Manifest } from "@cadabracraft/format";
import { epubChecks } from "./exportChecks";

const book = (titles: string[]): Manifest => ({
  ...createManifest({ title: "Book", author: "", identifier: "id-1" }),
  chapters: titles.map((title, i) => ({ id: `c${i}`, file: `chapters/c${i}.json`, title })),
});

describe("epubChecks", () => {
  it("warns about untitled chapters and counts them", () => {
    expect(epubChecks(book(["", "One", " "]))).toEqual([{ tone: "warn", text: "2 chapters have no title" }]);
  });
  it("warns when the book has no chapters", () => {
    expect(epubChecks(book([]))).toEqual([{ tone: "warn", text: "This book has no chapters yet." }]);
  });
  it("reports no problems when every chapter has a title", () => {
    expect(epubChecks(book(["One", "Two"]))).toEqual([{ tone: "ok", text: "No problems found" }]);
  });
});

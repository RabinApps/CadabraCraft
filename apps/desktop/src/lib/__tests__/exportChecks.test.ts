import { describe, expect, it } from "vitest";
import { createManifest, type Manifest } from "@cadabracraft/format";
import { epubChecks, kdpGutterMinIn, pdfChecks } from "../exportChecks";

describe("kdpGutterMinIn", () => {
  it.each([
    [23, null],
    [24, 0.375],
    [150, 0.375],
    [151, 0.5],
    [300, 0.5],
    [301, 0.625],
    [500, 0.625],
    [501, 0.75],
    [700, 0.75],
    [701, 0.875],
    [828, 0.875],
    [829, null],
  ])("%i pages -> %j", (pages, min) => {
    expect(kdpGutterMinIn(pages)).toBe(min);
  });
});

describe("pdfChecks", () => {
  const ok = { top: 0.8, bottom: 0.9, inside: 0.9, outside: 0.65 };
  const fine = [{ tone: "ok", text: "No problems found" }];
  const run = (estimatedPages: number, margins = ok, hasCover = true) =>
    pdfChecks({ estimatedPages, margins, hasCover });

  it("reports no problems for a normal book", () => {
    expect(run(200)).toEqual(fine);
  });
  it("errors below 24 pages and not at 24", () => {
    expect(run(23)[0]).toMatchObject({ tone: "error" });
    expect(run(23)[0]?.text).toContain("at least 24");
    expect(run(23)[0]?.text).toContain("estimate");
    expect(run(24)).toEqual(fine);
  });
  it("errors above 828 pages and not at 828", () => {
    expect(run(829)[0]).toMatchObject({ tone: "error" });
    expect(run(829)[0]?.text).toContain("at most 828");
    expect(run(828)).toEqual(fine);
  });
  it("skips page checks for an empty book", () => {
    expect(run(0)).toEqual(fine);
  });
  it.each([
    [24, 0.375],
    [150, 0.375],
    [151, 0.5],
    [300, 0.5],
    [301, 0.625],
    [500, 0.625],
    [501, 0.75],
    [700, 0.75],
    [701, 0.875],
    [828, 0.875],
  ])("at %i pages the inside margin needs %f in", (pages, min) => {
    expect(run(pages, { ...ok, inside: min })).toEqual(fine);
    const low = run(pages, { ...ok, inside: min - 0.01 });
    expect(low).toHaveLength(1);
    expect(low[0]?.tone).toBe("warn");
    expect(low[0]?.text).toContain("Inside margin");
  });
  it("needs the larger gutter once the book passes a boundary", () => {
    const m = { ...ok, inside: 0.5 };
    expect(run(300, m)).toEqual(fine);
    expect(run(301, m)[0]?.tone).toBe("warn");
  });
  it("warns when top, bottom or outside is under 0.25 in", () => {
    for (const k of ["top", "bottom", "outside"] as const) {
      const c = run(200, { ...ok, [k]: 0.2 });
      expect(c).toHaveLength(1);
      expect(c[0]?.tone).toBe("warn");
    }
    expect(run(200, { ...ok, top: 0.25, bottom: 0.25, outside: 0.25 })).toEqual(fine);
    expect(run(0, { ...ok, top: 0.1 })[0]?.tone).toBe("warn");
  });
  it("adds an info note when there is no cover, without hiding other checks", () => {
    expect(run(200, ok, false)).toEqual([
      { tone: "info", text: expect.stringContaining("no cover image") },
    ]);
    expect(run(10, ok, false).map((x) => x.tone)).toEqual(["error", "info"]);
  });
});

const book = (titles: string[]): Manifest => ({
  ...createManifest({ title: "Book", author: "", identifier: "id-1" }),
  chapters: titles.map((title, i) => ({ id: `c${i}`, file: `chapters/c${i}.json`, title })),
});

describe("epubChecks", () => {
  it("warns about untitled chapters and counts them", () => {
    expect(epubChecks(book(["", "One", " "]))).toEqual([
      { tone: "warn", text: "2 chapters have no title" },
    ]);
  });
  it("warns when the book has no chapters", () => {
    expect(epubChecks(book([]))).toEqual([
      { tone: "warn", text: "This book has no chapters yet." },
    ]);
  });
  it("reports no problems when every chapter has a title", () => {
    expect(epubChecks(book(["One", "Two"]))).toEqual([{ tone: "ok", text: "No problems found" }]);
  });
});

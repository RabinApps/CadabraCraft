import { describe, expect, it } from "vitest";
import { getTemplate } from "@cadabracraft/templates";
import type { PdfChapter } from "../types";
import { loadMatterBook } from "./matterBook";
import { buildTypst } from "../typst";

const book = { title: "The Long Quay", author: "Test Author", language: "en" };
const { all } = loadMatterBook();
const withChoice = (id: string, verticalCenter: boolean): PdfChapter[] =>
  all.map((c) => (c.id === id ? { ...c, verticalCenter } : c));
const calls = (src: string, fn: string): string[] =>
  [...src.matchAll(new RegExp(`#${fn}\\(([^\\n]*)\\)\\[`, "g"))].map((m) => m[1]!);

describe("vertically centred matter in Typst", () => {
  it("centres the title page, dedication and epigraph by default", () => {
    const src = buildTypst(book, all);
    expect(calls(src, "title-page")).toEqual(['"fm-1", "title-page"']);
    expect(calls(src, "centered-page")).toEqual(['"fm-3", "dedication"']);
    expect(src).toContain("#let title-page(id, kind, body, centre: true)");
    expect(src).toContain("#let centered-page(id, kind, body, centre: true)");
    expect(src).toContain("align(center + if centre { horizon } else { top },");
  });

  it("puts a title page or dedication the author set to top at the top", () => {
    expect(calls(buildTypst(book, withChoice("fm-1", false)), "title-page")).toEqual([
      '"fm-1", "title-page", centre: false',
    ]);
    expect(calls(buildTypst(book, withChoice("fm-3", false)), "centered-page")).toEqual([
      '"fm-3", "dedication", centre: false',
    ]);
  });

  it("centres another kind the author asks for, with the centred page layout", () => {
    const src = buildTypst(book, withChoice("fm-4", true));
    expect(calls(src, "centered-page")).toEqual(['"fm-3", "dedication"', '"fm-4", "foreword"']);
    expect(src).not.toContain('#chapter-start("Foreword", none,');
    // Back matter too.
    expect(calls(buildTypst(book, withChoice("bm-2", true)), "centered-page")).toContain(
      '"bm-2", "about-the-author"',
    );
  });

  it("follows the template's kinds when the page has no choice", () => {
    const template = structuredClone(getTemplate("novel"));
    template.print.matter.verticalCenter = ["dedication"];
    const src = buildTypst(book, all, { template, fonts: { body: "Libertinus Serif" } });
    expect(calls(src, "title-page")).toEqual(['"fm-1", "title-page", centre: false']);
    expect(calls(src, "centered-page")).toEqual(['"fm-3", "dedication"']);
  });

  it("keeps the contents and copyright pages out of centring", () => {
    const src = buildTypst(book, withChoice("fm-2", true));
    expect(calls(src, "copyright-page")).toHaveLength(1);
  });
});

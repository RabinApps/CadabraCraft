import {
  addChapter,
  addFrontMatter,
  addTocCustom,
  createManifest,
  hideTocItem,
  setTocDepth,
} from "@cadabracraft/format";
import type { ChapterDoc } from "@cadabracraft/shared";
import { describe, expect, it } from "vitest";
import { bookContents, pdfToc, withContentsList } from "../tocExport";

const doc = (...headings: [number, string][]): ChapterDoc => ({
  type: "doc",
  content: headings.map(([level, text]) => ({
    type: "heading" as const,
    attrs: { level },
    content: [{ type: "text" as const, text }],
  })),
});

function book() {
  const base = addChapter(
    createManifest({ title: "B", author: "A", identifier: "id" }),
    "One",
  ).manifest;
  return base;
}

describe("bookContents", () => {
  it("is undefined when the book has no contents page, or the export leaves it out", () => {
    expect(bookContents(book(), "en", [])).toBeUndefined();
    const withPage = addFrontMatter(book(), "contents", "Contents").manifest;
    expect(
      bookContents(withPage, "en", [{ id: withPage.chapters[0]!.id, doc: doc() }]),
    ).toBeUndefined();
  });
  it("resolves the list from the exported pages: headings only at depth > 0, hidden ones flagged and left out of `visible`", () => {
    let { manifest } = addFrontMatter(book(), "contents", "Contents");
    const toc = manifest.frontMatter[0]!.id;
    const ch = manifest.chapters[0]!.id;
    const pages = [
      { id: toc, doc: doc() },
      { id: ch, doc: doc([1, "One"], [2, "Sub"]) },
    ];
    const flat = bookContents(manifest, "en", pages)!;
    expect(flat.entryId).toBe(toc);
    expect(flat.all.map((i) => i.title)).toEqual([manifest.chapters[0]!.titles.en]);
    expect(flat.pageNumbers).toBe(true);
    manifest = hideTocItem(setTocDepth(manifest, toc, 2), toc, ch);
    const deep = bookContents(manifest, "en", pages)!;
    expect(deep.all.map((i) => [i.title, i.hidden])).toEqual([
      [manifest.chapters[0]!.titles.en, true],
      ["One", false],
      ["Sub", false],
    ]);
    expect(deep.visible.map((i) => i.title)).toEqual(["One", "Sub"]);
    expect(pdfToc(deep)).toEqual({ items: deep.all, pageNumbers: true });
    expect(pdfToc(undefined)).toBeUndefined();
  });
});

describe("withContentsList", () => {
  it("appends one paragraph per visible entry to the contents page only", () => {
    let { manifest } = addFrontMatter(book(), "contents", "Contents");
    const toc = manifest.frontMatter[0]!.id;
    const ch = manifest.chapters[0]!.id;
    manifest = addTocCustom(setTocDepth(manifest, toc, 1), toc, {
      language: "en",
      title: "Afterword",
      after: ch,
    }).manifest;
    const pages = [
      { id: toc, doc: doc([1, "Contents"]) },
      { id: ch, doc: doc([1, "One"]) },
    ];
    const shown = withContentsList(pages, bookContents(manifest, "en", pages));
    expect(shown[1]).toBe(pages[1]);
    const added = shown[0]!.doc.content.slice(1);
    expect(added.map((n) => JSON.stringify(n))).toEqual([
      expect.stringContaining('"text":"One","marks"'),
      expect.stringContaining('"text":"Afterword","marks"'),
      expect.stringContaining("\u2003\u2003One"),
    ]);
  });
  it("changes nothing without a list", () => {
    const pages = [{ id: "a", doc: doc() }];
    expect(withContentsList(pages, undefined)).toEqual(pages);
    expect(
      withContentsList(pages, { entryId: "a", all: [], visible: [], pageNumbers: true }),
    ).toEqual(pages);
  });
});

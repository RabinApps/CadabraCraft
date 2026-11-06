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
import { bookContents, pdfToc } from "../export/tocExport";

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

describe("bookContents with pages left out of the export", () => {
  function twoChapters() {
    const base = addChapter(book(), "Two").manifest;
    let { manifest } = addFrontMatter(base, "contents", "Contents");
    const toc = manifest.frontMatter[0]!.id;
    const [one, two] = manifest.chapters.map((c) => c.id) as [string, string];
    manifest = addTocCustom(setTocDepth(manifest, toc, 1), toc, {
      language: "en",
      title: "Afterword",
      after: two,
      target: two,
    }).manifest;
    return { manifest, toc, one, two };
  }
  it("lists only the pages in the export, headings included", () => {
    const { manifest, toc, one, two } = twoChapters();
    const pages = [
      { id: toc, doc: doc() },
      { id: one, doc: doc([1, "Alpha"]) },
    ];
    const list = bookContents(manifest, "en", pages)!;
    expect(list.all.filter((i) => i.kind !== "custom").map((i) => i.entryId)).toEqual([one, one]);
    expect(list.all.some((i) => i.entryId === two)).toBe(false);
    // The custom entry stays (its text is the author's) but no longer links to a page that is not there.
    const custom = list.all.find((i) => i.kind === "custom")!;
    expect(custom.title).toBe("Afterword");
    expect(custom.entryId).toBeUndefined();
    expect(custom.target).toBe(two);
    expect(list.visible).toEqual(list.all);
  });
  it("keeps a custom entry that points at an exported page linked", () => {
    const { manifest, toc, one, two } = twoChapters();
    const pages = [toc, one, two].map((id) => ({ id, doc: doc() }));
    const custom = bookContents(manifest, "en", pages)!.all.find((i) => i.kind === "custom")!;
    expect(custom.entryId).toBe(two);
  });
  it("keeps a custom entry that has no target", () => {
    const { manifest: base, toc, one } = twoChapters();
    const manifest = addTocCustom(base, toc, {
      language: "en",
      title: "Note",
      after: one,
    }).manifest;
    const pages = [toc, one].map((id) => ({ id, doc: doc() }));
    expect(bookContents(manifest, "en", pages)!.all.map((i) => i.title)).toContain("Note");
  });
});

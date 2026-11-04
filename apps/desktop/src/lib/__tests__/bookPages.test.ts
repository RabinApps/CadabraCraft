import { describe, expect, it } from "vitest";
import type { BookPage } from "../../state/project/types";
import { bookPages, layoutOfPages } from "../bookPages";

const page = (
  id: string,
  section: BookPage["section"],
  words: number,
  kind?: BookPage["kind"],
): BookPage => ({
  id,
  title: id,
  section,
  ...(kind ? { kind } : {}),
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: Array.from({ length: words }, () => "word").join(" ") }],
      },
    ],
  },
});

describe("layoutOfPages", () => {
  const book = { template: "modern" };

  it("places front matter, chapters and back matter on the pages the words give them", () => {
    const layout = layoutOfPages(book, [
      page("title", "front", 0, "title-page"),
      page("copyright", "front", 0, "copyright"),
      page("c1", "chapter", 0),
      page("c2", "chapter", 0),
      page("afterword", "back", 0, "acknowledgments"),
    ]);
    expect(layout.entries.map((e) => [e.id, e.folio])).toEqual([
      ["title", ""],
      ["copyright", ""],
      ["c1", "1"],
      ["c2", "2"],
      ["afterword", "3"],
    ]);
    // Front matter in roman, the body from arabic 1: no page restarts at 1 in the middle of the book.
    expect(layout.entries.map((e) => e.style)).toEqual([
      "roman",
      "roman",
      "arabic",
      "arabic",
      "arabic",
    ]);
    expect(layout.physical).toBe(5);
  });

  it("gives a chapter that opens on a right-hand page the blank page before it", () => {
    const layout = layoutOfPages(
      { template: "novel" },
      [page("c1", "chapter", 0), page("c2", "chapter", 0)],
      { measured: new Map([["c1", 1]]) },
    );
    expect(layout.byId.get("c2")).toMatchObject({ start: 3, blankBefore: true, cardStart: 2 });
  });

  it("takes a measured count and reports exactness from every count it has", () => {
    const pages = [page("c1", "chapter", 0), page("c2", "chapter", 0)];
    expect(layoutOfPages(book, pages).exact).toBe(false);
    const measured = layoutOfPages(book, pages, {
      measured: new Map([
        ["c1", 1],
        ["c2", 1],
      ]),
    });
    expect(measured.exact).toBe(true);
  });
});

describe("bookPages", () => {
  it("counts the whole interior, blank pages included, and reports the trim size", () => {
    const pages = [page("c1", "chapter", 0), page("c2", "chapter", 0)];
    expect(bookPages({ template: "novel", trimSize: "6x9" }, pages)).toEqual({
      trimSize: "6x9",
      pages: 3,
      exact: false,
    });
  });
});

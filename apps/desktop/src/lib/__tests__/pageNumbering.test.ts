import { describe, expect, it } from "vitest";
import type { PageReport } from "@cadabracraft/export-pdf";
import {
  bookLayout,
  bookWordsPerPage,
  chapterPageCount,
  chapterStart,
  type EntryWords,
} from "../pageNumbering";

const book = { template: "modern" };
const front = (id: string, kind: EntryWords["kind"]): EntryWords => ({
  id,
  section: "front",
  kind,
  words: 0,
});
const chapter = (id: string, words = 0): EntryWords => ({ id, section: "chapter", words });
const report = (starts: PageReport["starts"]): PageReport => ({ total: 40, starts });
const start = (id: string, page: number, end: number, number: string) => ({
  id,
  kind: "chapter",
  page,
  end,
  number,
});

describe("bookLayout", () => {
  it("numbers the front matter in roman and the chapters from arabic 1 on, continuing through the book", () => {
    const layout = bookLayout(
      book,
      [front("title", "title-page"), front("contents", "contents"), chapter("c1"), chapter("c2")],
      {},
    );
    expect(layout.entries.map((e) => [e.id, e.style, e.folio])).toEqual([
      ["title", "roman", ""],
      ["contents", "roman", ""],
      ["c1", "arabic", "1"],
      ["c2", "arabic", "2"],
    ]);
    expect(layout.arabicFrom).toBe(5);
    expect(layout.bodyPages).toBe(2);
  });

  it("estimates an entry's pages from its words, and marks the count as an estimate", () => {
    const perPage = bookWordsPerPage(book);
    const layout = bookLayout(book, [chapter("c1", perPage * 2 + 1), chapter("c2")], {});
    expect(layout.byId.get("c1")).toMatchObject({ pages: 3, exact: false });
    expect(layout.byId.get("c2")!.folio).toBe("4");
    expect(layout.exact).toBe(false);
  });

  it("takes Typst's page counts from a report, and its starts only while the report is current", () => {
    const pages = report([start("c1", 1, 2, "1"), start("c2", 6, 7, "6")]);
    const stale = bookLayout(book, [chapter("c1"), chapter("c2")], { report: pages, fresh: false });
    // The counts are Typst's (c2 takes 2 pages, so c1's start stands), but the text moved on since: they stay estimates.
    expect(stale.byId.get("c2")).toMatchObject({ pages: 2, start: 3, exact: false });
    const fresh = bookLayout(book, [chapter("c1"), chapter("c2")], { report: pages, fresh: true });
    expect(fresh.byId.get("c2")).toMatchObject({ start: 6, folio: "6" });
  });

  it("takes an editor's measured count over a stale report's", () => {
    const pages = report([start("c1", 1, 3, "1"), start("c2", 7, 8, "6")]);
    const layout = bookLayout(book, [chapter("c1"), chapter("c2")], {
      report: pages,
      fresh: false,
      measured: new Map([["c1", 2]]),
    });
    expect(layout.byId.get("c1")).toMatchObject({ pages: 2, exact: true });
    expect(layout.byId.get("c2")!.start).toBe(3);
  });

  it("numbers nothing when the book prints no page numbers", () => {
    const layout = bookLayout(book, [chapter("c1")], { numbered: false });
    expect(layout.entries.map((e) => e.folio)).toEqual([""]);
    expect(layout.numbered).toBe(false);
  });
});

describe("print parameters", () => {
  it("takes the chapter opening from the template", () => {
    expect(chapterStart({ template: "novel" })).toBe("recto");
    expect(chapterStart({ template: "modern" })).toBe("any");
    expect(chapterStart({ template: "gone" })).toBe(chapterStart({ template: "novel" }));
  });

  it("gives a words-per-page and a one-page minimum per entry", () => {
    expect(bookWordsPerPage(book)).toBeGreaterThanOrEqual(50);
    expect(chapterPageCount(0, 250)).toBe(1);
    expect(chapterPageCount(251, 250)).toBe(2);
  });
});

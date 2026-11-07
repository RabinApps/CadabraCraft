// Integration: real Typst. The page layout `layoutBook` (packages/shared) computes from each entry's page count must be the one Typst
// reports for the same book: where every entry starts, and the number printed there. Skips without Typst unless REQUIRE_TYPST=1.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { layoutBook, formatFolio, type PageEntryInput } from "@cadabracraft/shared";
import type { DocNode, MatterKind } from "@cadabracraft/shared";
import { getTemplate } from "@cadabracraft/templates";
import { measurePages } from "../measure";
import { createNodeRunner } from "../node";
import { matterPages, page } from "./matterBook";
import type { PdfChapter } from "../types";

const ready = spawnSync("typst", ["--version"], { stdio: "ignore" }).status === 0;
const suite = ready ? describe : describe.skip;
const T = 180_000;

const word = (i: number) => ["quiet", "garden", "river", "stone", "letter"][i % 5]!;
const para = (seed: number): DocNode => ({
  type: "paragraph",
  content: [
    {
      type: "text",
      text: Array.from({ length: 60 }, (_, i) => word(i * 7 + seed)).join(" ") + ".",
    },
  ],
});
const chapter = (id: string, title: string, paragraphs: number): PdfChapter => ({
  id,
  title,
  doc: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
      ...Array.from({ length: paragraphs }, (_, i) => para(i)),
    ],
  },
});

/** Title page, copyright, contents, dedication, foreword, preface, three chapters of different lengths, two back matter pages. */
function book(): PdfChapter[] {
  const { front, back } = matterPages();
  const toc = page("toc", "Contents", "front", "contents", { type: "doc", content: [] });
  return [
    front[0]!,
    front[1]!,
    toc,
    ...front.slice(2),
    chapter("c1", "One", 40),
    chapter("c2", "Two", 30),
    chapter("c3", "Three", 25),
    ...back,
  ];
}

/** Renders `chapters` with Typst and checks that `layoutBook` reports the same pages, and the same numbers printed on them. */
async function sameAsTypst(chapters: PdfChapter[], id: "novel" | "nonfiction" | "modern") {
  const template = getTemplate(id);
  const report = await measurePages(
    { title: "T", author: "A", language: "en" },
    chapters,
    {
      template: id,
      trimSize: "5.5x8.5",
      pageNumbers: true,
      fonts: { body: "Libertinus Serif" },
    },
    createNodeRunner(),
  );
  const entries: PageEntryInput[] = chapters.map((c) => {
    const s = report.starts.find((r) => r.id === c.id)!;
    return {
      id: c.id,
      section: c.section ?? "chapter",
      kind: c.kind as MatterKind | undefined,
      pages: s.end - s.page + 1,
      exact: true,
      startOnNext: c.startOnNext,
    };
  });
  const laid = layoutBook(entries, { startsOn: template.print.chapterOpening.startOn });
  for (const s of report.starts) {
    const own = laid.byId.get(s.id)!;
    const printed = own.number === null ? "" : formatFolio(own.number, own.style);
    expect([s.id, own.start, printed], JSON.stringify(report.starts)).toEqual([
      s.id,
      s.page,
      s.number,
    ]);
  }
  expect(laid.physical).toBe(report.total);
  return report;
}

suite("the page layout equals Typst's", () => {
  for (const id of ["novel", "nonfiction", "modern"] as const) {
    it(`${id}: starts and printed numbers`, () => sameAsTypst(book(), id), T);
  }
});

suite("a page the author starts on the next one, real Typst", () => {
  const choose = (id: string) => book().map((c) => (c.id === id ? { ...c, startOnNext: true } : c));

  it(
    "drops the blank page before a dedication and its page still counts",
    async () => {
      const rules = await sameAsTypst(book(), "novel");
      const chosen = await sameAsTypst(choose("fm-3"), "novel");
      const at = (r: typeof rules, id: string) => r.starts.find((s) => s.id === id)!.page;
      // The dedication opens on a right-hand page by rule, so a blank left-hand page goes before it; the choice removes it.
      expect(at(rules, "fm-3") % 2).toBe(1);
      expect(at(chosen, "fm-3")).toBe(at(rules, "fm-3") - 1);
      expect(at(chosen, "fm-3") % 2).toBe(0);
      // The book is shorter, and by more than the one page: the shift also takes away a blank a later chapter no longer needs.
      expect(chosen.total).toBeLessThan(rules.total);
      expect(chosen.total).toBeGreaterThanOrEqual(rules.total - 2);
      // The foreword after a dedication still opens on a right-hand page; on the back of a verso dedication that is the next page.
      expect(at(chosen, "fm-4")).toBe(at(chosen, "fm-3") + 1);
      expect(at(chosen, "fm-4") % 2).toBe(1);
    },
    T,
  );

  it(
    "inserts the blank page before a page the author starts on a right-hand one",
    async () => {
      const choose = (id: string) =>
        book().map((c) => (c.id === id ? { ...c, startOnNext: false } : c));
      const rules = await sameAsTypst(book(), "modern");
      const chosen = await sameAsTypst(choose("fm-5"), "modern");
      const at = (r: typeof rules, id: string) => r.starts.find((s) => s.id === id)!.page;
      // Modern Memoir starts chapters on any page, so the preface follows on; the choice gives it the blank left-hand page.
      expect(at(rules, "fm-5") % 2).toBe(0);
      expect(at(chosen, "fm-5")).toBe(at(rules, "fm-5") + 1);
      expect(at(chosen, "fm-5") % 2).toBe(1);
      // The inserted blank page makes the book at least a page longer (a later page that lands on a right-hand one differently
      // can add or drop one of its own).
      expect(chosen.total).toBeGreaterThan(rules.total);
    },
    T,
  );

  it(
    "lets the first page after the front matter follow on when the author chooses, restarting the count there",
    async () => {
      const { front, back } = matterPages();
      const pages = [...front, { ...back[0]!, startOnNext: true }, ...back.slice(1)];
      const report = await sameAsTypst(pages, "novel");
      // The restart would put the acknowledgments on a right-hand page; the choice keeps them on the next one.
      const first = report.starts.find((s) => s.id === "bm-1")!;
      expect(first.page).toBe(report.starts.find((s) => s.id === "fm-5")!.end + 1);
      expect(first.number).toBe("1");
    },
    T,
  );
});

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

suite("the page layout equals Typst's", () => {
  for (const id of ["novel", "nonfiction", "modern"] as const) {
    it(
      `${id}: starts and printed numbers`,
      async () => {
        const template = getTemplate(id);
        const chapters = book();
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
      },
      T,
    );
  }
});

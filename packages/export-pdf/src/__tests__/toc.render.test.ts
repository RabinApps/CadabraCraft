// Integration: real Typst and poppler. Skips without them unless REQUIRE_TYPST=1 (render.test.ts reports missing prerequisites).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tocBook, itemsAtDepth } from "./tocBook";
import { measurePages, type PageReport } from "../measure";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";
import type { PdfOptions, PdfTocItem } from "../types";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const ready = has("typst", ["--version"]) && has("pdftotext", ["-v"]);
const suite = ready ? describe : describe.skip;
const T = 280_000;
const runner = createNodeRunner();

function pagesOf(pdf: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cc-toc-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" })
      .split("\f")
      .slice(0, -1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const lines = (p: string): string[] =>
  p
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

interface Row {
  title: string;
  number: string;
}
/** The rows of the Contents pages (title, dot leaders, number; the dots are spaced); a row without leaders has an empty number. */
function rows(pdf: Uint8Array, report: PageReport): { rows: Row[]; pages: string[] } {
  const toc = report.starts.find((s) => s.id === "toc")!;
  const pages = pagesOf(pdf).slice(toc.page - 1, toc.end);
  const out = pages
    .flatMap(lines)
    .slice(1) // the page's own heading
    .map((l): Row => {
      const m = /^(.*?)\s*(?:\.\s*){3,}([ivxlc0-9]+)$/.exec(l);
      if (m) return { title: m[1]!, number: m[2]! };
      // a right-to-left title makes the whole line run right to left: the number comes first in the text order
      const rtl = /^([ivxlc0-9]+)\s*(?:\.\s*){3,}(.*)$/.exec(l);
      return rtl ? { title: rtl[2]!, number: rtl[1]! } : { title: l, number: "" };
    });
  return { rows: out, pages };
}

/** The printed number of the report's entry. */
const numberOf = (report: PageReport, id: string): string =>
  report.starts.find((s) => s.id === id)!.number;

const roman = /^[ivxlc]+$/;
const arabic = /^\d+$/;

async function both(
  book: ReturnType<typeof tocBook>,
  items: PdfTocItem[],
  extra: Partial<PdfOptions> = {},
  pageNumbers = true,
) {
  const options: PdfOptions = {
    trimSize: "5.5x8.5",
    chapterStart: "recto",
    toc: { items, pageNumbers },
    ...extra,
  };
  const report = await measurePages(book.book, book.pages, options, runner);
  const { pdf } = await renderPdf(book.book, book.pages, options, runner);
  return { report, ...rows(pdf, report), pdf };
}

suite("Contents page with real Typst", () => {
  it(
    "prints the numbers of the page report, roman before the first chapter and arabic after",
    async () => {
      const b = tocBook({ chapters: 3, foreword: true });
      const { report, rows: r } = await both(b, itemsAtDepth(b.items, 0));
      expect(r.map((x) => x.title)).toEqual(["Foreword", "Chapter 1", "Chapter 2", "Chapter 3"]);
      expect(r.map((x) => x.number)).toEqual(
        ["fw", "ch-1", "ch-2", "ch-3"].map((id) => numberOf(report, id)),
      );
      expect(r[0]!.number).toMatch(roman);
      expect(r[1]!.number).toBe("1");
      expect(r.slice(1).every((x) => arabic.test(x.number))).toBe(true);
    },
    T,
  );

  it(
    "lists headings with indent at depth 2 and none at depth 0, numbers inside their chapter",
    async () => {
      const b = tocBook({
        chapters: 2,
        paragraphs: 14,
        headings: [
          [2, "The Storm"],
          [3, "Too deep"],
          [2, "The Calm"],
        ],
      });
      const flat = await both(b, itemsAtDepth(b.items, 0));
      const deep = await both(b, itemsAtDepth(b.items, 2));
      expect(flat.rows).toHaveLength(2);
      expect(deep.rows.map((x) => x.title)).toEqual([
        "Chapter 1",
        "Chapter 1",
        "The Storm",
        "The Calm",
        "Chapter 2",
        "Chapter 2",
        "The Storm",
        "The Calm",
      ]);
      const nums = deep.rows.map((x) => Number(x.number));
      expect(nums).toEqual([...nums].sort((a, c) => a - c));
      const end1 = deep.report.starts.find((s) => s.id === "ch-1")!;
      const first = Number(numberOf(deep.report, "ch-1"));
      expect(nums[2]).toBeGreaterThanOrEqual(first);
      expect(nums[3]).toBeLessThanOrEqual(first + end1.end - end1.page);
      expect(deep.rows[0]!.number).toBe(numberOf(deep.report, "ch-1"));
      // nesting shows as indent in the layout text
      const text = deep.pages.join("\n");
      const indentOf = (t: string): number =>
        /^( *)/.exec(text.split("\n").find((l) => l.includes(t))!)![1]!.length;
      expect(indentOf("The Storm")).toBeGreaterThan(indentOf("Chapter 2"));
    },
    T,
  );

  it(
    "keeps numbers consistent when the list grows to two pages and pushes the roman matter",
    async () => {
      const small = tocBook({ chapters: 3, foreword: true, paragraphs: 2 });
      // 55 chapters fill two pages, which keeps the foreword on page iii (the first recto after them): it takes three to push it
      const big = tocBook({ chapters: 80, foreword: true, paragraphs: 1 });
      const a = await both(small, itemsAtDepth(small.items, 0));
      const c = await both(big, itemsAtDepth(big.items, 0));
      const toc = c.report.starts.find((s) => s.id === "toc")!;
      expect(toc.end - toc.page).toBeGreaterThanOrEqual(2);
      expect(c.rows).toHaveLength(81);
      expect(c.rows.map((x) => x.number)).toEqual(
        [
          "fw",
          ...big.items.filter((i) => i.kind === "page" && i.key !== "fw").map((i) => i.key),
        ].map((id) => numberOf(c.report, id)),
      );
      // the foreword moved with the longer list
      expect(numberOf(c.report, "fw")).not.toBe(numberOf(a.report, "fw"));
      expect(c.report.starts.find((s) => s.id === "ch-1")!.number).toBe("1");
    },
    T,
  );

  it(
    "shows renamed and custom entries, hides hidden ones, and points a custom entry at its target",
    async () => {
      const b = tocBook({ chapters: 3 });
      const items: PdfTocItem[] = [
        { key: "ch-1", kind: "page", level: 0, title: "Opening (renamed) #1 $", entryId: "ch-1" },
        { key: "ch-2", kind: "page", level: 0, title: "Hidden", entryId: "ch-2", hidden: true },
        { key: "ch-3", kind: "page", level: 0, title: "שלום", entryId: "ch-3" },
        { key: "custom:m", kind: "custom", level: 0, title: "Map of the quay", target: "ch-2" },
        { key: "custom:n", kind: "custom", level: 0, title: "Nowhere", target: "gone" },
        { key: "custom:o", kind: "custom", level: 0, title: "No target" },
      ];
      const { report, rows: r } = await both(b, items);
      const titles = r.map((x) => x.title.replace(/\s+/g, " "));
      expect(titles).not.toContain("Hidden");
      expect(titles[0]).toBe("Opening (renamed) #1 $");
      expect(r.find((x) => x.title === "Map of the quay")!.number).toBe(numberOf(report, "ch-2"));
      expect(r.find((x) => x.title === "Nowhere")!.number).toBe("");
      expect(r.find((x) => x.title === "No target")!.number).toBe("");
      expect(r.find((x) => x.title.includes("שלום") || x.title.includes("םולש"))!.number).toBe(
        numberOf(report, "ch-3"),
      );
    },
    T,
  );

  it(
    "indents the wrapped lines of a long title further than its first line",
    async () => {
      const b = tocBook({ chapters: 1 });
      const long =
        "A very long contents title that surely has to wrap onto a second line of the page";
      const items: PdfTocItem[] = [
        { key: "ch-1", kind: "page", level: 0, title: long, entryId: "ch-1" },
      ];
      const { report, pages } = await both(b, items);
      const ls = pages.flatMap((p) => p.split("\n")).filter((l) => l.trim() !== "");
      const first = ls.findIndex((l) => l.includes("A very long"));
      const indentOf = (l: string): number => /^( *)/.exec(l)![1]!.length;
      expect(ls[first + 1]).toMatch(/\.\s*\.\s*\.\s*\S+$/);
      expect(indentOf(ls[first + 1]!)).toBeGreaterThan(indentOf(ls[first]!));
      expect(ls[first + 1]!.trim().endsWith(numberOf(report, "ch-1"))).toBe(true);
    },
    T,
  );

  it(
    "starts on a right-hand page and shows no folio or running header on any of its pages",
    async () => {
      const b = tocBook({ chapters: 55, foreword: true, paragraphs: 1 });
      const { report, pages } = await both(b, itemsAtDepth(b.items, 0));
      const toc = report.starts.find((s) => s.id === "toc")!;
      expect(toc.page % 2).toBe(1);
      expect(toc.number).toBe("");
      expect(pages.length).toBeGreaterThan(1);
      for (const p of pages) {
        const ls = lines(p);
        expect(ls.at(-1)).not.toMatch(/^[ivxlc\d]+$/);
        expect(ls.some((l) => l === "Quay" || l === "Chapter 1" || l === "Contents")).toBe(
          p === pages[0],
        );
      }
    },
    T,
  );

  it(
    "leaves numbers and leaders out when page numbers are off",
    async () => {
      const b = tocBook({ chapters: 3 });
      const { rows: r, pages } = await both(b, itemsAtDepth(b.items, 0), {}, false);
      expect(r.map((x) => x.title)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
      expect(r.every((x) => x.number === "")).toBe(true);
      expect(pages.join("\n")).not.toContain("...");
      // the footer numbers of the book are not affected by the contents switch
      const rep = await measurePages(
        b.book,
        b.pages,
        { trimSize: "5.5x8.5", toc: { items: itemsAtDepth(b.items, 0), pageNumbers: false } },
        runner,
      );
      expect(rep.starts.find((s) => s.id === "ch-1")!.number).toBe("1");
    },
    T,
  );

  it(
    "converges on a book with about 300 contents entries",
    async () => {
      const b = tocBook({
        chapters: 75,
        paragraphs: 1,
        headings: [
          [2, "Alpha"],
          [2, "Beta"],
          [3, "Gamma"],
        ],
      });
      const items = itemsAtDepth(b.items, 3);
      expect(items.length).toBeGreaterThanOrEqual(300);
      const { report, rows: r } = await both(b, items);
      expect(r).toHaveLength(items.length);
      const pageRows = r.filter((x) => /^Chapter \d+$/.test(x.title));
      // every chapter appears twice (page and its own h1); the page entries come first
      const chapterNumbers = r.filter((_, i) => items[i]!.kind === "page").map((x) => x.number);
      expect(chapterNumbers).toEqual(
        items.filter((i) => i.kind === "page").map((i) => numberOf(report, i.key)),
      );
      expect(pageRows.length).toBe(150);
      expect(r.every((x) => x.number !== "")).toBe(true);
    },
    T,
  );
});

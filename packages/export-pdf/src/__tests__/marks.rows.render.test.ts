// Integration: real Typst. A table row that runs over a page break: Typst starts every cell of the row on the row's page and cuts each
// cell where its own text reaches the foot of the page, and the marks say where, cell by cell. Page view draws that (one spacer per
// cell), and its rules rest on what is checked here against the text of every page.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocNode } from "@cadabracraft/shared";
import { measurePages } from "../measure";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";
import type { PdfChapter, PdfOptions } from "../types";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const suite = has("typst", ["--version"]) && has("pdftotext", ["-v"]) ? describe : describe.skip;
const T = 300_000;
const runner = createNodeRunner();
const book = { title: "Rows", author: "A. Writer", language: "en" };
const options: PdfOptions = { template: "novel", chapterStart: "any", trimSize: "5x8" };

const text = (t: string): DocNode => ({ type: "text", text: t }) as DocNode;

function pages(pdf: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cc-rows-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    return execFileSync("pdftotext", [file, "-"], { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\f")
      .slice(0, -1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A paragraph of `count` words, each unique in the book. */
interface Para {
  node: DocNode;
  tokens: string[];
}
function para(counter: { n: number }, count: number): Para {
  const tokens = Array.from({ length: count }, () => `w${String(counter.n++).padStart(6, "0")}x`);
  return { node: { type: "paragraph", content: [text(tokens.join(" "))] } as DocNode, tokens };
}

/** A row: the paragraphs of each of its cells, as word counts. */
type RowShape = number[][];

suite("a table row that runs over a page break, with real Typst", () => {
  /**
   * One chapter per `pad` paragraphs before a table of `rows` (each cell of a row has the paragraphs its shape says), checked against
   * the text of the pages: the cells of a row all start on the row's page; a paragraph starts on the page of its first word, ends on the
   * page of its last, and a cell goes on from one page to the next without skipping one. Returns how many rows ran over a page break,
   * how many ran over two, and how many cells of a row ran over while another did not.
   */
  async function sweep(label: string, pads: number[], rows: RowShape[]) {
    const c = { n: 0 };
    const all: { pad: number; table: Para[][][] }[] = [];
    const chapters: PdfChapter[] = pads.map((pad, i) => {
      const content: DocNode[] = [];
      for (let k = 0; k < pad; k++) content.push(para(c, 14).node);
      const table = rows.map((r) => r.map((cell) => cell.map((n) => para(c, n))));
      all.push({ pad, table });
      content.push({
        type: "table",
        content: table.map((r) => ({
          type: "tableRow",
          content: r.map((cell) => ({
            type: "tableCell",
            content: cell.map((p) => p.node),
          })),
        })),
      } as DocNode);
      content.push(para(c, 8).node);
      return { id: `${label}${i}`, title: "T", doc: { type: "doc", content } };
    });
    const plain = await renderPdf(book, chapters, options, runner);
    const marked = await renderPdf(book, chapters, { ...options, blockMarks: true }, runner);
    const texts = pages(plain.pdf);
    // Marks change nothing on a page.
    expect(pages(marked.pdf)).toEqual(texts);
    const report = await measurePages(book, chapters, { ...options, blockMarks: true }, runner);
    const pageOf = (token: string): number => texts.findIndex((t) => t.includes(token)) + 1;
    const found = { over: 0, overTwice: 0, uneven: 0 };
    chapters.forEach((ch, i) => {
      const { pad, table } = all[i]!;
      const units = report.blocks![ch.id]!;
      // The leaves in the report's order: the `pad` paragraphs, then every paragraph of every cell, row by row, then the last one.
      let at = pad;
      table.forEach((row, r) => {
        const rowPage = units[at]!.page;
        let last = rowPage;
        const cellEnds: number[] = [];
        row.forEach((cell, k) => {
          let cur = rowPage;
          cell.forEach((p, j) => {
            const u = units[at++]!;
            const where = `${label} ${ch.id} row ${r} cell ${k} paragraph ${j}`;
            expect(u.block, where).toBe(pad);
            expect(u.page, where).toBe(pageOf(p.tokens[0]!));
            if (j === 0) expect(u.page, `${where} starts on the row's page`).toBe(rowPage);
            else expect([cur, cur + 1], where).toContain(u.page);
            let page = u.page;
            u.splits.forEach((s, q) => {
              expect(s.page, `${where} split ${q}`).toBe(page + 1);
              expect(pageOf(p.tokens[s.word]!), `${where} split ${q}`).toBe(s.page);
              expect(pageOf(p.tokens[s.word - 1]!), `${where} split ${q} before`).toBe(page);
              page = s.page;
            });
            expect(pageOf(p.tokens.at(-1)!), where).toBe(page);
            cur = page;
          });
          cellEnds.push(cur);
          last = Math.max(last, cur);
        });
        if (last > rowPage) found.over++;
        if (last > rowPage + 1) found.overTwice++;
        if (last > rowPage && cellEnds.some((e) => e === rowPage)) found.uneven++;
        // The next row starts on the page this one ended on, or the next.
        if (r + 1 < table.length) expect([last, last + 1]).toContain(units[at]!.page);
      });
      expect(units.length).toBe(at + 1);
    });
    return found;
  }
  const range = (n: number, step = 1) => Array.from({ length: n }, (_, i) => i * step);

  it(
    "short rows beside a tall one: a cell that ends before the page does and one that runs over",
    async () => {
      const r = await sweep("uneven", range(40), [
        [[5], [7]],
        [[60], [10, 30, 40]],
        [[8], [6]],
      ]);
      expect(r.over).toBeGreaterThan(3);
      expect(r.uneven).toBeGreaterThan(0);
    },
    T,
  );

  it(
    "a row taller than a page runs over two page breaks, cells of different heights, paragraphs starting on the next page",
    async () => {
      const r = await sweep("tall", range(30, 2), [
        [[140], [20, 90, 90, 10], [30]],
        [[6], [6], [6]],
      ]);
      expect(r.overTwice).toBeGreaterThan(2);
      expect(r.over).toBeGreaterThan(8);
    },
    T,
  );
});

// Integration: real Typst. Skips without it (render.test.ts reports missing prerequisites under REQUIRE_TYPST=1).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMatterBook } from "./matterBook";
import { measurePages } from "../measure";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const hasTypst = has("typst", ["--version"]);
const hasPdfinfo = has("pdfinfo", ["-v"]);
const suite = hasTypst ? describe : describe.skip;
const T = 180_000;

const { book, assets, all, chapters } = loadMatterBook();
const runner = createNodeRunner();

function pdfPageCount(pdf: Uint8Array): number {
  const dir = mkdtempSync(join(tmpdir(), "cc-measure-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    const out = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    return Number(/^Pages:\s+(\d+)/m.exec(out)![1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

suite("measurePages with real Typst", () => {
  it(
    "reports ordered starts, restarts numbers at 1 after front matter, and matches the PDF",
    async () => {
      const options = { assets, chapterStart: "recto" as const };
      const r = await measurePages(book, all, options, runner);
      expect(r.starts.map((s) => s.id)).toEqual(all.map((p) => p.id));
      expect(r.starts.map((s) => s.kind)).toEqual(
        all.map((p) => (p.section === undefined || p.section === "chapter" ? "chapter" : p.kind)),
      );
      const pages = r.starts.map((s) => s.page);
      expect(pages).toEqual([...pages].sort((a, b) => a - b));
      expect(new Set(pages).size).toBe(pages.length);
      expect(pages[0]).toBe(1);
      // Title and copyright pages are unnumbered; other front matter is roman; the first chapter is page 1 on a right-hand page.
      const byId = Object.fromEntries(r.starts.map((s) => [s.id, s]));
      expect(byId["fm-1"]!.number).toBe("");
      expect(byId["fm-2"]!.number).toBe("");
      expect(byId["fm-4"]!.number).toMatch(/^[ivxl]+$/);
      const first = byId[chapters[0]!.id]!;
      expect(first.number).toBe("1");
      expect(first.page % 2).toBe(1);
      for (const s of r.starts.filter((x) => x.page >= first.page))
        expect(s.number).toBe(String(s.page - first.page + 1));
      // Each entry ends on or after its start and before the next one starts (a blank verso is in no entry).
      r.starts.forEach((s, i) => {
        expect(s.end).toBeGreaterThanOrEqual(s.page);
        const next = r.starts[i + 1];
        if (next) expect(s.end).toBeLessThan(next.page);
      });
      expect(r.starts.at(-1)!.end).toBeLessThanOrEqual(r.total);
      expect(r.total).toBeGreaterThanOrEqual(pages.at(-1)!);
      if (hasPdfinfo) {
        const { pdf } = await renderPdf(book, all, options, runner);
        expect(r.total).toBe(pdfPageCount(pdf));
      }
    },
    T,
  );

  it(
    "numbers a book without front matter from 1 and leaves numbers empty when page numbers are off",
    async () => {
      const r = await measurePages(book, chapters, { assets }, runner);
      expect(r.starts[0]).toMatchObject({ id: chapters[0]!.id, page: 1, number: "1" });
      const off = await measurePages(book, chapters, { assets, pageNumbers: false }, runner);
      expect(off.starts.every((s) => s.number === "")).toBe(true);
      expect(off.total).toBe(r.total);
    },
    T,
  );
});

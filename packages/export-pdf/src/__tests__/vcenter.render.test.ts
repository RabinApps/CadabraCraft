// Integration: real Typst and poppler. Skips without them unless REQUIRE_TYPST=1 (render.test.ts reports missing prerequisites).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMatterBook } from "./matterBook";
import { createNodeRunner } from "../node";
import { renderPdf as render } from "../render";
import type { PdfChapter } from "../types";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const ready = has("typst", ["--version"]) && has("pdftotext", ["-v"]);
const suite = ready ? describe : describe.skip;
const T = 180_000;

const { book, assets, all } = loadMatterBook();
const withChoice = (id: string, verticalCenter: boolean): PdfChapter[] =>
  all.map((c) => (c.id === id ? { ...c, verticalCenter } : c));

/** The top and bottom (pt from the top of the page) of the words on page `n` (1-based), and the page height. */
function extent(pdf: Uint8Array, n: number): { top: number; bottom: number; height: number } {
  const dir = mkdtempSync(join(tmpdir(), "cc-vc-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    const xml = execFileSync("pdftotext", ["-bbox", "-f", String(n), "-l", String(n), file, "-"], {
      encoding: "utf8",
    });
    // Words inside the text box only: a running header or page number sits in the margins.
    const ys = [...xml.matchAll(/yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)"/g)]
      .map((m) => [Number(m[1]), Number(m[2])])
      .filter((y) => y[0]! >= 50 && y[1]! <= 552);
    const height = Number(/<page width="[\d.]+" height="([\d.]+)"/.exec(xml)![1]);
    return {
      top: Math.min(...ys.map((y) => y[0]!)),
      bottom: Math.max(...ys.map((y) => y[1]!)),
      height,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

suite("vertically centred matter, real Typst", () => {
  // Classic Novel: 5.5 x 8.5 in, margins top 0.8 in and bottom 0.9 in, so the text box runs from 57.6 pt to 547.2 pt.
  const middle = (612 - 0.9 * 72 + 0.8 * 72) / 2;
  const opts = { assets, fonts: { body: "Libertinus Serif" } };

  it(
    "puts the title page's block between the margins and at the top when the author says top",
    async () => {
      const centred = extent((await render(book, all, opts, createNodeRunner())).pdf, 1);
      expect((centred.top + centred.bottom) / 2).toBeCloseTo(middle, -1);
      const top = extent(
        (await render(book, withChoice("fm-1", false), opts, createNodeRunner())).pdf,
        1,
      );
      // The heading starts a little below the margin (57.6 pt); centred, the block starts well below that.
      expect(top.top).toBeLessThan(110);
      expect(centred.top).toBeGreaterThan(top.top + 40);
      expect(top.bottom).toBeLessThan(middle);
    },
    T,
  );

  it(
    "centres the dedication, and a foreword the author centres",
    async () => {
      // Title page, copyright (verso), dedication on the next recto: find it by its own text.
      const pdf = (await render(book, withChoice("fm-4", true), opts, createNodeRunner())).pdf;
      const dir = mkdtempSync(join(tmpdir(), "cc-vc-"));
      try {
        const file = join(dir, "x.pdf");
        writeFileSync(file, pdf);
        const pages = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" })
          .split("\f")
          .slice(0, -1);
        for (const word of ["harbour keepers", "foreword paragraph"]) {
          const n = pages.findIndex((p) => p.includes(word)) + 1;
          expect(n, word).toBeGreaterThan(0);
          const e = extent(pdf, n);
          expect((e.top + e.bottom) / 2, word).toBeCloseTo(middle, -1);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    T,
  );
});

// Integration: real Typst and poppler. Skips without them unless REQUIRE_TYPST=1 (render.test.ts reports missing prerequisites).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocNode } from "@cadabracraft/shared";
import { createNodeRunner } from "../node";
import { renderPdf as render } from "../render";
import type { PdfChapter } from "../types";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const ready = has("typst", ["--version"]) && has("pdftotext", ["-v"]);
const suite = ready ? describe : describe.skip;
const T = 180_000;

const book = { title: "Blank Lines", author: "Test Author", language: "en" };
const text = (t: string): DocNode => ({ type: "text", text: t });
const para = (...t: string[]): DocNode => ({
  type: "paragraph",
  content: [text(t.join(" "))],
});
const chapter = (...content: DocNode[]): PdfChapter[] => [
  { id: "c", title: "C", doc: { type: "doc", content } },
];

/**
 * The top (pt from the top of the page) of every line of body text on page `n`, sorted. Words in the margins (a running header
 * or a page number at the foot) are left out.
 */
function lines(pdf: Uint8Array, n = 1): number[] {
  const dir = mkdtempSync(join(tmpdir(), "cc-blank-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    const xml = execFileSync("pdftotext", ["-bbox", "-f", String(n), "-l", String(n), file, "-"], {
      encoding: "utf8",
    });
    const tops = [...xml.matchAll(/yMin="([\d.]+)"/g)]
      .map((m) => Number(m[1]))
      .filter((y) => y >= 50 && y < 540);
    return [...new Set(tops.map((y) => Math.round(y * 100) / 100))].sort((a, b) => a - b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

suite("a paragraph the author left empty, real Typst", () => {
  const opts = { template: "poetry" as const, fonts: { body: "Libertinus Serif" } };
  const render1 = async (c: PdfChapter[]) => (await render(book, c, opts, createNodeRunner())).pdf;

  it(
    "takes the height of one line of the body, the paragraph spacing unchanged",
    async () => {
      // The pitch of a body line, from a paragraph that wraps onto a second line.
      const wrapped = await render1(
        chapter(para(Array.from({ length: 60 }, (_, i) => `word${i + 1}`).join(" "))),
      );
      const w = lines(wrapped);
      expect(w.length).toBeGreaterThan(1);
      const pitch = w[1]! - w[0]!;

      const two = lines(await render1(chapter(para("Alpha"), para("Gamma"))));
      const three = lines(await render1(chapter(para("Alpha"), para(), para("Gamma"))));
      expect(two).toHaveLength(2);
      expect(three).toHaveLength(2);
      // One more line of the body between the two paragraphs, exactly.
      expect(three[1]! - three[0]! - (two[1]! - two[0]!)).toBeCloseTo(pitch, 1);
    },
    T,
  );

  it(
    "keeps the blank line under a chapter's own title heading, below its drop cap",
    async () => {
      const h1: DocNode = { type: "heading", attrs: { level: 1 }, content: [text("The Quay")] };
      const pdf = (
        await render(
          book,
          chapter(h1, para(), para("Opening line.")),
          { template: "novel", fonts: { body: "Libertinus Serif" } },
          createNodeRunner(),
        )
      ).pdf;
      const dir = mkdtempSync(join(tmpdir(), "cc-blank-"));
      try {
        const file = join(dir, "x.pdf");
        writeFileSync(file, pdf);
        const page = execFileSync("pdftotext", ["-f", "1", "-l", "1", file, "-"], {
          encoding: "utf8",
        });
        expect(page).toContain("The Quay");
        expect(page).toContain("Opening line");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    T,
  );
});

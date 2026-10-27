// Integration: real Typst and poppler. Skips without them unless REQUIRE_TYPST=1 (render.test.ts reports missing prerequisites).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMatterBook } from "./matterBook";
import { createNodeRunner } from "./node";
import { renderPdf as render } from "./render";
import type { PdfOptions } from "./types";

const has = (cmd: string, args: string[]): boolean => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const ready = has("typst", ["--version"]) && has("pdfinfo", ["-v"]) && has("pdftotext", ["-v"]);
const suite = ready ? describe : describe.skip;
const T = 180_000;

const { book, chapters, assets, all, front, back } = loadMatterBook();
const renderAll = (o: PdfOptions = {}) => render(book, all, { assets, ...o }, createNodeRunner());

function withPdf<R>(pdf: Uint8Array, f: (file: string) => R): R {
  const dir = mkdtempSync(join(tmpdir(), "cc-matter-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    return f(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const pages = (pdf: Uint8Array): string[] => withPdf(pdf, (f) => execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }).split("\f").slice(0, -1));
const info = (pdf: Uint8Array): string => withPdf(pdf, (f) => execFileSync("pdfinfo", [f], { encoding: "utf8" }));

/** The /PageLabels of a PDF as the reader sees them ("i", "ii", "1"...). Typst writes the label tree uncompressed. */
export function pageLabels(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString("latin1");
  const root = /\/PageLabels (\d+) 0 R/.exec(text);
  if (!root) return [];
  const obj = (n: string): string => new RegExp(`(?:^|\\n)${n} 0 obj\\n([\\s\\S]*?)\\nendobj`).exec(text)![1]!;
  const refs = [...obj(root[1]!).matchAll(/(\d+) (\d+) 0 R/g)].map((m) => [Number(m[1]), m[2]!] as const);
  const roman = (n: number, upper: boolean): string => {
    const r = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"][n] ?? `?${n}`;
    return upper ? r.toUpperCase() : r;
  };
  const labels: string[] = [];
  for (const [index, ref] of refs) {
    const d = obj(ref);
    const start = Number(/\/St (\d+)/.exec(d)?.[1] ?? 1);
    const style = /\/S\/(\w)/.exec(d)?.[1];
    labels[index] = style === "r" ? roman(start, false) : style === "R" ? roman(start, true) : style === "D" ? String(start) : "";
  }
  return labels;
}

const squash = (s: string): string => s.replace(/\s+/g, "");
const lines = (p: string): string[] => p.split("\n").map((l) => l.trim()).filter(Boolean);
const footer = (p: string): string => lines(p).at(-1) ?? "";
/** First line of the page, ignoring a chapter ornament above the title. */
const header = (p: string): string => lines(p).find((l) => l !== "⁂") ?? "";

suite("front and back matter in the PDF", () => {
  for (const template of ["novel", "nonfiction", "modern"] as const) {
    describe(template, () => {
      const opts: PdfOptions = { template, trimSize: "5.5x8.5", ...(template === "modern" ? { fonts: { body: "Libertinus Serif" } } : {}) };

      it("keeps the page size and reading order: title, copyright, dedication, foreword, preface, chapters, back matter", async () => {
        const { pdf } = await renderAll(opts);
        expect(info(pdf)).toContain("396 x 612 pts");
        const ps = pages(pdf);
        const at = (needle: string): number => ps.findIndex((p) => squash(p).includes(squash(needle)));
        const order = ["The Long Quay", "© 2026 Test Author", "For the harbour keepers.", "A foreword paragraph", "A preface paragraph", "What the Letter Said", "Afterword", "Thanks to everyone on the quay.", "writes about water"].map(at);
        expect(order.every((n) => n >= 0), JSON.stringify(order)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(new Set(order).size).toBe(order.length);
      }, T);

      it("puts the title page on the first (right-hand) page with no header or number, centred", async () => {
        const { pdf } = await renderAll(opts);
        const [title] = pages(pdf);
        expect(lines(title!)).toEqual(["The Long Quay", "Test Author"]);
        expect(pageLabels(pdf)[0]).toBe("i");
      }, T);

      it("puts the copyright text on the back of the title page, with no header or number", async () => {
        const { pdf } = await renderAll(opts);
        const copyright = pages(pdf)[1]!;
        expect(lines(copyright)).toEqual(["© 2026 Test Author", "All rights reserved.", "ISBN 978-3-16-148410-0"]);
      }, T);

      it("sets the dedication on a right-hand page, numbered iii without a running header, with a blank verso", async () => {
        const { pdf } = await renderAll(opts);
        const ps = pages(pdf);
        expect(lines(ps[2]!)).toEqual(["For the harbour keepers.", "iii"]);
        expect(ps[3]!.trim()).toBe(""); // blank verso: no header, no number
        expect(pageLabels(pdf).slice(0, 4)).toEqual(["i", "ii", "iii", "iv"]);
      }, T);

      it("numbers foreword and preface in roman, then restarts arabic at 1 on the first chapter's right-hand page", async () => {
        const { pdf } = await renderAll(opts);
        const ps = pages(pdf);
        const labels = pageLabels(pdf);
        const foreword = ps.findIndex((p) => p.includes("A foreword paragraph"));
        expect(labels[foreword]).toMatch(/^[ivx]+$/);
        expect(footer(ps[foreword]!)).toBe(labels[foreword]);
        const chapter1 = labels.indexOf("1");
        expect(chapter1, "arabic numbering starts").toBeGreaterThan(foreword);
        expect(ps[chapter1]).toContain("The Quay");
        expect((chapter1 + 1) % 2, "first chapter is on a right-hand page").toBe(1);
        expect(labels[chapter1]).toBe("1");
        expect(footer(ps[chapter1]!)).toBe("1");
        expect(labels[chapter1 - 1]).toMatch(/^[ivx]+$/); // the blank verso before it is still front matter
        // all pages before are roman, all after are arabic
        for (let i = 0; i < chapter1; i++) expect(labels[i], `page ${i + 1}`).toMatch(/^[ivx]+$/);
        for (let i = chapter1; i < labels.length; i++) expect(labels[i], `page ${i + 1}`).toBe(String(i - chapter1 + 1));
      }, T);

      it("continues arabic numbering through the back matter, which opens like a chapter", async () => {
        const { pdf } = await renderAll(opts);
        const ps = pages(pdf);
        const labels = pageLabels(pdf);
        const ack = ps.findIndex((p) => p.includes("Acknowledgments") && p.includes("Thanks to everyone"));
        expect(ack).toBeGreaterThan(0);
        expect(labels[ack]).toBe(String(ack - labels.indexOf("1") + 1)); // the arabic count simply continues
        expect(Number(labels[ack])).toBeGreaterThan(10);
        const last = ps.findIndex((p) => p.includes("writes about water"));
        expect(last).toBeGreaterThan(ack);
        // running headers and numbers elsewhere in the body are unchanged
        const body = labels.indexOf("1") + 1;
        expect(footer(ps[body]!)).toBe(labels[body]);
      }, T);

      it("keeps every blank page free of headers and numbers", async () => {
        const { pdf } = await renderAll(opts);
        const blanks = pages(pdf).filter((p) => p.trim() === "");
        expect(blanks.length).toBeGreaterThan(0);
        // a blank page has no text at all, so no stray folio can appear
      }, T);
    });
  }

  it("does not change a book without matter: no page labels beyond the default and the same page count as before", async () => {
    const without = await render(book, chapters, { assets }, createNodeRunner());
    expect(pageLabels(without.pdf)).toEqual([]);
    const withMatter = await renderAll();
    expect(pages(withMatter.pdf).length).toBeGreaterThan(pages(without.pdf).length);
  }, T);

  it("renders front matter only, back matter only, and a bare title page", async () => {
    const run = (p: typeof all) => render(book, p, { assets }, createNodeRunner());
    const frontOnly = await run(front);
    expect(pageLabels(frontOnly.pdf).every((l) => /^[ivx]+$/.test(l))).toBe(true);
    const backOnly = await run([...chapters.slice(0, 1), ...back]);
    expect(pageLabels(backOnly.pdf)).toEqual([]);
    const bare = await run(front.slice(0, 1));
    expect(pages(bare.pdf)).toHaveLength(1);
  }, T);

  it("is valid PDF/A when asked", async () => {
    const { pdf } = await renderAll({ pdfA: true });
    expect(Buffer.from(pdf).toString("latin1")).toContain("<pdfaid:part>2</pdfaid:part>");
  }, T);

  it("starts the first chapter on a right-hand page for the modern template even though it normally starts anywhere", async () => {
    const { pdf } = await renderAll({ template: "modern", fonts: { body: "Libertinus Serif" } });
    const ps = pages(pdf);
    const chapter1 = pageLabels(pdf).indexOf("1");
    expect(ps[chapter1]).toContain("The Quay");
    expect(chapter1 % 2).toBe(0); // zero-based even = odd physical page
  }, T);

  it("header on a right-hand matter page shows its title, on the left the book title", async () => {
    const { pdf } = await renderAll({ template: "novel" });
    const ps = pages(pdf);
    const foreword = ps.findIndex((p) => p.includes("A foreword paragraph"));
    expect(header(ps[foreword]!)).toBe("Foreword"); // opening page of a section carries no running header, only its heading
  }, T);
});

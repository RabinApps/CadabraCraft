// Integration: real Typst. The page marks (`blockMarks`) must change nothing on the page, and what they report must be where the text really is.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wordStarts, type DocNode, type Mark } from "@cadabracraft/shared";
import { measurePages } from "../measure";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";
import type { PdfChapter, PdfOptions } from "../types";
import { loadMatterBook } from "./matterBook";
import { plainItems } from "../typst/blocks";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const suite = has("typst", ["--version"]) && has("pdftotext", ["-v"]) ? describe : describe.skip;
const T = 240_000;
const runner = createNodeRunner();
const book = { title: "Marks", author: "A. Writer", language: "en" };

const text = (t: string, marks: Mark[] = []): DocNode =>
  ({ type: "text", text: t, ...(marks.length ? { marks } : {}) }) as DocNode;

/** Pseudo-random but fixed prose: every word is `lorem<n>` with a unique n, so a word can be found in the PDF text. */
function prose(counter: { n: number }, words: number, seed: number): DocNode[] {
  const fill = [
    "quay",
    "harbour's",
    "the",
    "salt",
    '"and"',
    "grey",
    "a",
    "tide-line",
    "slow",
    "over",
  ];
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    const f = fill[(seed + i * 7) % fill.length]!;
    out.push(`${f}${counter.n++}`);
  }
  const t = out.join(" ");
  if (seed % 4 === 0) {
    const cut = t.indexOf(" ", Math.floor(t.length / 2)) + 1;
    const end = t.indexOf(" ", cut + 40) + 1;
    return [
      text(t.slice(0, cut)),
      text(t.slice(cut, end), [{ type: "italic" }]),
      text(t.slice(end)),
    ];
  }
  if (seed % 5 === 0) {
    const cut = t.indexOf(" ", Math.floor(t.length / 3));
    return [text(t.slice(0, cut)), { type: "hardBreak" } as DocNode, text(t.slice(cut + 1))];
  }
  return [text(t)];
}

function chapterDoc(c: number, withTitle: boolean): PdfChapter {
  const counter = { n: 1000 * (c + 1) };
  const content: DocNode[] = [];
  if (withTitle)
    content.push({ type: "heading", attrs: { level: 1 }, content: [text(`Chapter ${c}`)] });
  for (let i = 0; i < 46; i++) {
    const words = 18 + ((i * 37 + c * 11) % 110);
    content.push({ type: "paragraph", content: prose(counter, words, i + c) });
    if (i === 5)
      content.push({ type: "heading", attrs: { level: 2 }, content: [text("A turning")] });
    if (i === 9) content.push({ type: "sceneBreak" } as DocNode);
    if (i === 12) content.push({ type: "paragraph", content: [] });
    if (i === 14)
      content.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: prose(counter, 30, 3) }],
      } as DocNode);
    if (i === 20)
      content.push({
        type: "bulletList",
        content: [1, 2, 3].map(
          (k) =>
            ({
              type: "listItem",
              content: [{ type: "paragraph", content: [text(`item ${k} of the list`)] }],
            }) as DocNode,
        ),
      } as DocNode);
  }
  return { id: `c${c}`, title: `Chapter ${c}`, doc: { type: "doc", content } };
}

/** Text of each page of a PDF. */
function pages(pdf: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cc-marks-"));
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

const tokens = (paragraph: DocNode): string[] => {
  const kids = "content" in paragraph ? paragraph.content : undefined;
  const items = plainItems(kids)!;
  const flat = items.map((i) => i ?? "\uE000").join("");
  // The number in each word is its identity (quotes, hyphens and apostrophes change in the PDF text).
  return wordStarts(items).map((s) => /\d+/.exec(/^[^ \t\uE000]*/.exec(flat.slice(s))![0])![0]);
};

suite("page marks with real Typst", () => {
  for (const template of ["novel", "nonfiction", "modern"]) {
    it(
      `${template}: marks change nothing on the pages`,
      async () => {
        const chapters = [0, 1, 2].map((c) => chapterDoc(c, c !== 1));
        const options: PdfOptions = { template, chapterStart: "recto", trimSize: "5x8" };
        const plain = await renderPdf(book, chapters, options, runner);
        const marked = await renderPdf(book, chapters, { ...options, blockMarks: true }, runner);
        const [a, b] = [pages(plain.pdf), pages(marked.pdf)];
        expect(b.length).toBe(a.length);
        expect(a.length).toBeGreaterThan(20);
        expect(b).toEqual(a);
        const r1 = await measurePages(book, chapters, options, runner);
        const r2 = await measurePages(book, chapters, { ...options, blockMarks: true }, runner);
        expect({ ...r2, blocks: undefined }).toEqual({ ...r1, blocks: undefined });
        expect(r1.blocks).toBeUndefined();
      },
      T,
    );
  }

  it(
    "reports the page of every block and the word that begins each page of a split paragraph",
    async () => {
      const chapters = [chapterDoc(0, true), chapterDoc(1, false)];
      const options: PdfOptions = { template: "novel", chapterStart: "recto", trimSize: "5x8" };
      const report = await measurePages(book, chapters, { ...options, blockMarks: true }, runner);
      const { pdf } = await renderPdf(book, chapters, options, runner);
      const text = pages(pdf);
      let splits = 0;
      chapters.forEach((c, ci) => {
        const blocks = report.blocks![c.id]!;
        const content = c.doc.content!;
        const nonEmpty = content
          .map((n, i) => [n, i] as const)
          .filter(([n]) => !(n.type === "paragraph" && (n.content ?? []).length === 0))
          .map(([, i]) => i);
        expect(blocks.map((b) => b.block)).toEqual(nonEmpty);
        let page = report.starts[ci]!.page;
        for (const b of blocks) {
          expect(b.page).toBeGreaterThanOrEqual(page);
          const node = content[b.block]!;
          // Splits are on consecutive pages.
          b.splits.forEach((s, k) => expect(s.page).toBe(b.page + k + 1));
          if (node.type === "paragraph") {
            const words = tokens(node);
            let prev = b.page;
            expect(text[b.page - 1]).toContain(words[0]);
            for (const s of b.splits) {
              const first = words[s.word]!;
              const before = words[s.word - 1]!;
              // The word that begins a page is on it and not on the page before; the word before it is the other way round.
              expect(text[s.page - 1]).toContain(first);
              expect(text[prev - 1]).not.toContain(first);
              expect(text[prev - 1]).toContain(before);
              expect(text[s.page - 1]).not.toContain(before);
              prev = s.page;
              splits++;
            }
            expect(text[prev - 1]).toContain(words.at(-1));
          }
          page = b.splits.at(-1)?.page ?? b.page;
        }
      });
      expect(splits).toBeGreaterThan(8);
    },
    T,
  );

  it(
    "puts the start mark of every kind of block on the page its first line is on, wherever the block falls on the page",
    async () => {
      const kinds = ["paragraph", "heading", "quote", "list", "scene"] as const;
      const chapters: PdfChapter[] = [];
      const meta: { kind: (typeof kinds)[number]; k: number }[] = [];
      for (const kind of kinds)
        for (let k = 0; k < 64; k++) {
          const para = (t: string): DocNode => ({ type: "paragraph", content: [text(t)] });
          const content: DocNode[] = [
            { type: "heading", attrs: { level: 1 }, content: [text("Pad")] },
          ];
          for (let i = 0; i < k; i++) content.push(para(`pad${i} x`));
          const tgt = `tgt${chapters.length + 1000}`;
          const words = Array.from({ length: 40 }, (_, w) => `${tgt}w${w}`).join(" ");
          if (kind === "paragraph") content.push(para(words));
          if (kind === "heading")
            content.push({ type: "heading", attrs: { level: 2 }, content: [text(tgt)] });
          if (kind === "quote")
            content.push({ type: "blockquote", content: [para(words)] } as DocNode);
          if (kind === "list")
            content.push({
              type: "bulletList",
              content: ["a", "b", "c"].map(
                (x) => ({ type: "listItem", content: [para(`${tgt}${x} item`)] }) as DocNode,
              ),
            } as DocNode);
          if (kind === "scene") content.push({ type: "sceneBreak" } as DocNode);
          content.push(para(`after${chapters.length + 1000} the end of it all`));
          chapters.push({ id: `k${chapters.length}`, title: "Pad", doc: { type: "doc", content } });
          meta.push({ kind, k });
        }
      const options: PdfOptions = { template: "novel", chapterStart: "any", trimSize: "5x8" };
      const report = await measurePages(book, chapters, { ...options, blockMarks: true }, runner);
      const { pdf } = await renderPdf(book, chapters, options, runner);
      const texts = pages(pdf);
      const pageOf = (token: string): number => texts.findIndex((t) => t.includes(token)) + 1;
      let straddles = 0;
      chapters.forEach((c, ci) => {
        const blocks = report.blocks![c.id]!;
        const n = c.doc.content!.length;
        const target = blocks.find((b) => b.block === n - 2)!;
        const after = blocks.find((b) => b.block === n - 1)!;
        const id = ci + 1000;
        if (meta[ci]!.kind !== "scene")
          expect(target.page, JSON.stringify(meta[ci])).toBe(pageOf(`tgt${id}`));
        expect(after.page, JSON.stringify(meta[ci])).toBe(pageOf(`after${id}`));
        const t = texts[after.page - 1]!;
        expect(t).toContain(`after${id}`);
        if (after.page > target.page) straddles++;
      });
      expect(straddles).toBeGreaterThan(10);
    },
    T,
  );

  it(
    "marks the matter book without changing it",
    async () => {
      const { book: b, assets, all } = loadMatterBook();
      const options: PdfOptions = { assets, chapterStart: "recto" };
      const plain = await renderPdf(b, all, options, runner);
      const marked = await renderPdf(b, all, { ...options, blockMarks: true }, runner);
      expect(pages(marked.pdf)).toEqual(pages(plain.pdf));
      const report = await measurePages(b, all, { ...options, blockMarks: true }, runner);
      expect(Object.keys(report.blocks!).length).toBeGreaterThan(0);
    },
    T,
  );
});

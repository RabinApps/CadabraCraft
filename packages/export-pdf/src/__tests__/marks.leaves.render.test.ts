// Integration: real Typst. The marks of the leaves inside quotes, lists, tables, definition lists, code blocks, headings, drop cap
// paragraphs and paragraphs with footnotes and code: they change nothing on the page, and every leaf is reported where its first and
// last words really are.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wordStarts, type DocNode, type Mark } from "@cadabracraft/shared";
import { measurePages, type BlockPages } from "../measure";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";
import type { PdfChapter, PdfOptions } from "../types";
import { loadFullBook } from "./fixtures";
import { loadMatterBook } from "./matterBook";
import { plainItems } from "../typst/blocks";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const suite = has("typst", ["--version"]) && has("pdftotext", ["-v"]) ? describe : describe.skip;
const T = 300_000;
const runner = createNodeRunner();
const book = { title: "Leaves", author: "A. Writer", language: "en" };
const { assets } = loadFullBook();

const text = (t: string, marks: Mark[] = []): DocNode =>
  ({ type: "text", text: t, ...(marks.length ? { marks } : {}) }) as DocNode;

/** Every word is `w`, six digits and an `x` (a footnote mark after a word is a digit), so any word can be found in the text of a page and in no other word. */
function words(counter: { n: number }, count: number, prefix = "w"): string {
  return Array.from(
    { length: count },
    () => `${prefix}${String(counter.n++).padStart(6, "0")}x`,
  ).join(" ");
}

function pages(pdf: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), "cc-leaves-"));
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

/** A leaf the way the test finds it by itself (no code of the exporter): its kind and the token of each word (line) it has. */
interface Leaf {
  block: number;
  kind: "p" | "h" | "s" | "i" | "k";
  tokens: string[];
}

const SOFT_HYPHEN = String.fromCharCode(0xad);
const digits = (word: string): string => /\d+x/.exec(word)![0];
/** Stands in for anything that is no text (a hard break, a footnote) in the flat text, where it takes the room `wordStarts` gives it. */
const OTHER = String.fromCharCode(0xe000);
/** The number in a word is its identity (a drop cap splits the first letter off the word). */
const wordTokens = (kids: DocNode[] | undefined): string[] => {
  const items = plainItems(kids);
  const flat = items
    .map((i) => (typeof i === "string" ? i : OTHER.repeat(i === null ? 1 : i)))
    .join("");
  const word = new RegExp(`^[^ \\t${OTHER}]*`);
  return wordStarts(items).map((s) => digits(word.exec(flat.slice(s))![0]));
};

function leavesOf(node: DocNode, block: number, out: Leaf[]): void {
  const kids = "content" in node ? node.content : undefined;
  switch (node.type) {
    case "paragraph":
      if ((kids ?? []).length > 0) out.push({ block, kind: "p", tokens: wordTokens(kids) });
      return;
    case "definitionTerm":
      return void out.push({ block, kind: "p", tokens: wordTokens(kids) });
    case "heading":
      return void out.push({ block, kind: "h", tokens: wordTokens(kids) });
    case "sceneBreak":
      return void out.push({ block, kind: "s", tokens: [] });
    case "image":
      return void out.push({ block, kind: "i", tokens: [] });
    case "codeBlock": {
      const lines = (kids ?? [])
        .map((k) => (k.type === "text" ? k.text : ""))
        .join("")
        .split("\n");
      return void out.push({ block, kind: "k", tokens: lines.map((l) => digits(l)) });
    }
    case "table": {
      const rows = kids ?? [];
      const header = (
        rows[0]?.type === "tableRow" && "content" in rows[0] ? rows[0].content : []
      )!.every((c) => c.type === "tableHeader");
      rows.forEach((r, i) => {
        if (!(header && i === 0)) leavesOf(r, block, out);
      });
      return;
    }
    default:
      for (const k of kids ?? []) leavesOf(k, block, out);
  }
}

const para = (c: { n: number }, k: number): DocNode =>
  ({ type: "paragraph", content: [text(words(c, k))] }) as DocNode;

/** What the report says about every leaf of every chapter must be what the text of the PDF says. Returns how many leaves began a page and how many words did. */
function verify(
  chapters: PdfChapter[],
  blocks: Record<string, BlockPages[]>,
  texts: string[],
  label: string,
): { starts: number; splits: number } {
  const pageOf = (token: string): number => texts.findIndex((t) => t.includes(token)) + 1;
  let starts = 0;
  let splits = 0;
  for (const c of chapters) {
    const leaves: Leaf[] = [];
    (c.doc.content ?? []).forEach((n, i) => leavesOf(n, i, leaves));
    const units = blocks[c.id] ?? [];
    expect(units.length, `${label} ${c.id}: leaves`).toBe(leaves.length);
    let end = units[0]?.page ?? 0;
    leaves.forEach((leaf, k) => {
      const u = units[k]!;
      const at = `${label} ${c.id} leaf ${k} (${leaf.kind})`;
      expect(u.block, at).toBe(leaf.block);
      expect(u.kind, at).toBe(leaf.kind);
      if (leaf.tokens.length > 0) expect(u.page, at).toBe(pageOf(leaf.tokens[0]!));
      expect(u.page, at).toBeGreaterThanOrEqual(end);
      expect(u.page - end, at).toBeLessThanOrEqual(1);
      if (k > 0 && u.page > end) starts++;
      let prev = u.page;
      u.splits.forEach((s, j) => {
        expect(s.page, at).toBe(u.page + j + 1);
        const first = leaf.tokens[s.word]!;
        expect(first, at).toBeDefined();
        // The word (line) that begins a page is on it and not on the page before; the one before it is the other way round.
        expect(pageOf(first), `${at} split ${j}`).toBe(s.page);
        expect(pageOf(leaf.tokens[s.word - 1]!), `${at} split ${j} before`).toBe(prev);
        prev = s.page;
        splits++;
      });
      if (leaf.tokens.length > 0) expect(pageOf(leaf.tokens.at(-1)!), at).toBe(prev);
      end = prev;
    });
  }
  return { starts, splits };
}

suite("the marks of the leaves inside blocks, with real Typst", () => {
  const options: PdfOptions = { template: "novel", chapterStart: "any", trimSize: "5x8" };

  /** One chapter per `pad` paragraphs in front of a block (so the block lands everywhere on the page), the page marks asked for. */
  async function sweep(
    label: string,
    pads: number[],
    make: (c: { n: number }) => DocNode[],
    template = options.template,
  ) {
    const c = { n: 0 };
    const chapters: PdfChapter[] = pads.map((pad, i) => {
      const content: DocNode[] = [];
      for (let k = 0; k < pad; k++) content.push(para(c, 14));
      content.push(...make(c));
      content.push(para(c, 8));
      return { id: `${label}${i}`, title: "T", doc: { type: "doc", content } };
    });
    const opts = { ...options, template, assets };
    const plain = await renderPdf(book, chapters, opts, runner);
    const marked = await renderPdf(book, chapters, { ...opts, blockMarks: true }, runner);
    const texts = pages(plain.pdf);
    // Marks change nothing on a page.
    expect(pages(marked.pdf)).toEqual(texts);
    const report = await measurePages(book, chapters, { ...opts, blockMarks: true }, runner);
    return verify(chapters, report.blocks!, texts, label);
  }
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  it(
    "quotes: each paragraph of a quote is where its words are, wherever the quote falls on the page",
    async () => {
      const r = await sweep("quote", range(40), (c) => [
        { type: "blockquote", content: [para(c, 30), para(c, 45), para(c, 20)] } as DocNode,
      ]);
      expect(r.splits).toBeGreaterThan(2);
      expect(r.starts).toBeGreaterThan(4);
    },
    T,
  );

  it(
    "lists: bullet, ordered and task items, and nested lists",
    async () => {
      const item = (c: { n: number }, k: number, extra: DocNode[] = []): DocNode =>
        ({ type: "listItem", content: [para(c, k), ...extra] }) as DocNode;
      const r = await sweep("list", range(40), (c) => [
        {
          type: "bulletList",
          content: [
            item(c, 12),
            item(c, 30, [{ type: "orderedList", content: [item(c, 9), item(c, 16)] } as DocNode]),
            item(c, 22),
            item(c, 10),
          ],
        } as DocNode,
        {
          type: "taskList",
          content: [1, 2, 3].map(
            () =>
              ({ type: "taskItem", attrs: { checked: false }, content: [para(c, 11)] }) as DocNode,
          ),
        } as DocNode,
      ]);
      expect(r.starts).toBeGreaterThan(4);
    },
    T,
  );

  it(
    "tables: the rows are where their cells' words are, and the repeated header row carries no marks",
    async () => {
      const cellOf = (kind: string, c: { n: number }, k: number): DocNode =>
        ({ type: kind, content: [para(c, k)] }) as DocNode;
      const r = await sweep("table", range(40), (c) => [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cellOf("tableHeader", c, 1), cellOf("tableHeader", c, 1)],
            },
            ...range(14).map(() => ({
              type: "tableRow",
              content: [cellOf("tableCell", c, 5), cellOf("tableCell", c, 7)],
            })),
          ],
        } as DocNode,
      ]);
      expect(r.starts).toBeGreaterThan(4);
    },
    T,
  );

  it(
    "definition lists and a heading that is several lines long",
    async () => {
      const r = await sweep("defs", range(40), (c) => [
        {
          type: "definitionList",
          content: [
            { type: "definitionTerm", content: [text(words(c, 3))] },
            { type: "definitionDescription", content: [para(c, 35)] },
            { type: "definitionTerm", content: [text(words(c, 2))] },
            { type: "definitionDescription", content: [para(c, 25), para(c, 25)] },
          ],
        } as DocNode,
        { type: "heading", attrs: { level: 2 }, content: [text(words(c, 26))] } as DocNode,
      ]);
      expect(r.starts).toBeGreaterThan(2);
    },
    T,
  );

  it(
    "code blocks: each line is where its text is",
    async () => {
      const r = await sweep("code", range(48), (c) => [
        {
          type: "codeBlock",
          content: [text(Array.from({ length: 70 }, () => `line ${words(c, 1)}`).join("\n"))],
        } as DocNode,
      ]);
      expect(r.splits).toBeGreaterThan(2);
    },
    T,
  );

  it(
    "paragraphs with footnotes, inline code and hard breaks: the words are marked around them",
    async () => {
      const r = await sweep("fn", range(44), (c) => [
        {
          type: "paragraph",
          content: [
            text(`${words(c, 18)} `),
            text(words(c, 4), [{ type: "code" }]),
            { type: "footnote", content: [text(`${words(c, 6, "n")}`)] } as DocNode,
            text(` ${words(c, 20)}`),
            { type: "hardBreak" } as DocNode,
            text(`${words(c, 30)} `),
            text(words(c, 3), [{ type: "bold" }, { type: "code" }]),
            text(` ${words(c, 40)}`),
          ],
        } as DocNode,
      ]);
      expect(r.splits).toBeGreaterThan(2);
    },
    T,
  );

  it(
    "images and scene breaks: where they fall on the page, they are reported on the page they are on",
    async () => {
      const r = await sweep("img", range(44), () => [
        {
          type: "image",
          attrs: { src: "assets/gradient.png", alt: "x", title: "A caption" },
        } as DocNode,
        { type: "sceneBreak" } as DocNode,
      ]);
      expect(r.starts).toBeGreaterThan(4);
    },
    T,
  );

  it(
    "the drop cap paragraph: its words are marked, even when it runs over pages",
    async () => {
      const c = { n: 0 };
      const long = (id: string, count: number): PdfChapter => ({
        id,
        title: "T",
        doc: {
          type: "doc",
          content: [
            { type: "paragraph", content: [text(words(c, count))] } as DocNode,
            para(c, 20),
          ],
        },
      });
      const chapters = [long("d1", 650), long("d2", 120), long("d3", 330)];
      const opts = { ...options, assets };
      const plain = await renderPdf(book, chapters, opts, runner);
      const marked = await renderPdf(book, chapters, { ...opts, blockMarks: true }, runner);
      expect(pages(marked.pdf)).toEqual(pages(plain.pdf));
      const report = await measurePages(book, chapters, { ...opts, blockMarks: true }, runner);
      const r = verify(chapters, report.blocks!, pages(plain.pdf), "dropcap");
      expect(r.splits).toBeGreaterThan(1);
    },
    T,
  );

  it(
    "a word Typst hyphenates across a page break begins the next page at the character the line broke at",
    async () => {
      const long = [
        "internationalization",
        "responsibilities",
        "extraordinarily",
        "misunderstanding",
        "unforgettable",
        "communications",
        "photographically",
        "representatives",
      ];
      const c = { n: 0 };
      const chapters: PdfChapter[] = Array.from({ length: 36 }, (_, i) => ({
        id: `h${i}`,
        title: "T",
        doc: {
          type: "doc",
          content: [
            ...Array.from({ length: i }, () => para(c, 14)),
            {
              type: "paragraph",
              content: [
                text(
                  Array.from({ length: 150 }, (_, k) => long[(k * 3 + i) % long.length]!).join(" "),
                ),
              ],
            } as DocNode,
          ],
        },
      }));
      const opts = { ...options, assets };
      const plain = await renderPdf(book, chapters, opts, runner);
      const texts = pages(plain.pdf);
      const report = await measurePages(book, chapters, { ...opts, blockMarks: true }, runner);
      let hyphenated = 0;
      for (const ch of chapters) {
        report.blocks![ch.id]!.forEach((u, k) => {
          const para = ch.doc.content![u.block]!;
          const kids = "content" in para ? para.content : undefined;
          const items = plainItems(kids);
          const flat = items.map((x) => (typeof x === "string" ? x : "")).join("");
          const starts = wordStarts(items);
          for (const s of u.splits) {
            if (s.char === undefined) continue;
            hyphenated++;
            const word = /^\S+/.exec(flat.slice(starts[s.word]!))![0];
            const head = word.slice(0, s.char);
            const tail = word.slice(s.char);
            // The page before ends its last line with the head and a hyphen, the page that begins in the word with the tail.
            // pdftotext writes the hyphen Typst adds as a soft hyphen.
            expect(texts[s.page - 2], `${ch.id} ${k} ${word} ${s.char}`).toMatch(
              new RegExp(`${head}[-${SOFT_HYPHEN}]\\n`),
            );
            expect(
              texts[s.page - 1]!.indexOf(tail),
              `${ch.id} ${k} ${word} ${s.char}`,
            ).toBeGreaterThanOrEqual(0);
            expect(texts[s.page - 1]!.indexOf(tail), `${ch.id} ${k} ${word}`).toBeLessThan(160);
          }
        });
      }
      expect(hyphenated).toBeGreaterThan(2);
      // The words are found as before: every split names the word the page begins in or at.
      const flatSplits = Object.values(report.blocks!)
        .flat()
        .flatMap((u) => u.splits);
      expect(flatSplits.length).toBeGreaterThan(hyphenated);
    },
    T,
  );

  it(
    "front and back matter are marked like chapters, and the marks change nothing",
    async () => {
      const { book: b, assets: a, all } = loadMatterBook();
      const o: PdfOptions = { assets: a, chapterStart: "recto" };
      const plain = await renderPdf(b, all, o, runner);
      const marked = await renderPdf(b, all, { ...o, blockMarks: true }, runner);
      expect(pages(marked.pdf)).toEqual(pages(plain.pdf));
      const report = await measurePages(b, all, { ...o, blockMarks: true }, runner);
      for (const page of all) {
        expect(report.blocks![page.id], page.id).toBeDefined();
        expect(report.blocks![page.id]![0]!.page, page.id).toBe(
          report.starts.find((s) => s.id === page.id)!.page,
        );
      }
    },
    T,
  );
});

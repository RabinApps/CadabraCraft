// Integration: real Typst and poppler. Skips without them unless REQUIRE_TYPST=1 (render.test.ts reports missing prerequisites).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
  type DocNode,
  type Mark,
} from "@cadabracraft/shared";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";
import type { PdfBook, PdfChapter, PdfOptions } from "../types";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const ready = has("typst", ["--version"]) && has("pdftotext", ["-v"]);
const suite = ready ? describe : describe.skip;
const T = 280_000;
const runner = createNodeRunner();

const book: PdfBook = { title: "The Long Quay", author: "A. Writer", language: "en" };
const t = (text: string, ...marks: Mark[]): DocNode => ({ type: "text", text, marks });
const ix = (id: string, term: string, extra: Record<string, string> = {}): Mark => ({
  type: "indexEntry",
  attrs: { id, term, ...extra },
});
const para = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const heading = (text: string): DocNode => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const chapter = (n: number, ...marks: [string, string, Record<string, string>?][]): PdfChapter => ({
  id: `ch-${n}`,
  title: `Chapter ${n}`,
  doc: doc(
    heading(`Chapter ${n}`),
    para(...marks.flatMap(([id, term, extra]) => [t(`mark ${id}`, ix(id, term, extra)), t(" ")])),
  ),
});

// Every chapter is one page and chapters may start on any page, so chapter n is printed page n.
const pages = (): PdfChapter[] => [
  chapter(1, ["a", "Orchard"], ["a2", "Orchard", { sub: "wall" }], ["b", "Tide"], ["c", "Pair"]),
  chapter(2, ["d", "Orchard"], ["e", "Pair"], ["f", "Magic", { see: "Sorcery" }]),
  chapter(3, ["g", "Orchard"], ["h", "Tide"], ["i", "Sorcery"]),
];

function text(pdf: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-index-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function render(o: { ranges?: boolean; letters?: boolean; columns?: 1 | 2 } = {}) {
  const sources = pages().map((c) => ({ id: c.id, doc: c.doc }));
  const options: PdfOptions = {
    trimSize: "5.5x8.5",
    chapterStart: "any",
    index: {
      heading: "Index",
      letterHeadings: o.letters ?? true,
      ranges: o.ranges ?? true,
      columns: o.columns ?? 2,
      tree: buildIndex(collectIndexMarks(sources)),
    },
    glossary: {
      heading: "Glossary",
      markFirstUse: true,
      items: buildGlossary(
        [
          {
            id: "harbour",
            term: "Harbour",
            definition: "Where boats tie up.\n\nSecond paragraph.",
          },
        ],
        collectGlossaryUses(sources),
      ).items,
    },
  };
  const { pdf } = await renderPdf(book, pages(), options, runner);
  return text(pdf);
}

suite("index and glossary pages with real Typst", () => {
  it(
    "prints the page of each place, a range for three pages in a row and a list for a pair",
    async () => {
      const out = await render();
      const index = out.slice(out.indexOf("Index "));
      expect(index).toContain("Orchard, 1–3");
      expect(index).toContain("Tide, 1, 3");
      expect(index).toContain("Pair, 1, 2");
      expect(index).toContain("wall, 1");
      expect(index).toMatch(/Magic See Sorcery/);
      expect(index).toMatch(/Sorcery, 3/);
    },
    T,
  );

  it(
    "lists every page when ranges are off, and leaves the letter headings out when asked",
    async () => {
      const out = await render({ ranges: false, letters: false, columns: 1 });
      const index = out.slice(out.indexOf("Index "));
      expect(index).toContain("Orchard, 1, 2, 3");
      expect(index).not.toMatch(/\bM Magic|\bO Orchard/);
    },
    T,
  );

  it(
    "prints roman numbers for places in the front matter and arabic ones after the first chapter",
    async () => {
      const front: PdfChapter = {
        id: "pre",
        title: "Preface",
        doc: doc(heading("Preface"), para(t("p", ix("z", "Early")))),
        section: "front",
        kind: "preface",
      };
      const all = [front, ...pages()];
      const sources = all.map((c) => ({ id: c.id, doc: c.doc }));
      const { pdf } = await renderPdf(
        book,
        all,
        {
          trimSize: "5.5x8.5",
          chapterStart: "any",
          index: {
            heading: "Index",
            letterHeadings: true,
            ranges: true,
            columns: 1,
            tree: buildIndex(collectIndexMarks(sources)),
          },
        },
        runner,
      );
      const out = text(pdf);
      const index = out.slice(out.indexOf("Index "));
      expect(index).toMatch(/Early, [ivx]+/);
      expect(index).toMatch(/Tide, 1, 3/);
    },
    T,
  );

  it(
    "writes the glossary after the index, a term then its meaning",
    async () => {
      const out = await render();
      const glossary = out.slice(out.indexOf("Glossary "));
      expect(glossary).toContain("Harbour Where boats tie up. Second paragraph.");
      expect(out.indexOf("Index ")).toBeLessThan(out.indexOf("Glossary "));
    },
    T,
  );
});

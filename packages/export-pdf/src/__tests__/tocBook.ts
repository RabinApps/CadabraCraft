// A small book with a Contents page for the contents tests (not part of the public API).
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { page } from "./matterBook";
import type { PdfChapter, PdfTocItem } from "../types";

const h = (level: number, t: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text: t }],
});
const p = (t: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });

export const filler = (n: number): DocNode[] =>
  Array.from({ length: n }, (_, i) =>
    p(`Paragraph ${i + 1}. ${"The tide came in over the quay and the lamps were lit. ".repeat(6)}`),
  );

export interface TocBookOptions {
  chapters?: number;
  /** Headings per chapter: [level, text] pairs, written before the filler. */
  headings?: [number, string][];
  paragraphs?: number;
  /** A foreword before the chapters. */
  foreword?: boolean;
}

/** Contents page (`toc`), optional foreword, then chapters `ch-1`...; items for every chapter and heading, like `resolveToc` at depth 3. */
export function tocBook(o: TocBookOptions = {}) {
  const n = o.chapters ?? 3;
  const headings = o.headings ?? [];
  const pages: PdfChapter[] = [page("toc", "Contents", "front", "contents", doc(h(1, "Contents")))];
  if (o.foreword)
    pages.push(page("fw", "Foreword", "front", "foreword", doc(h(1, "Foreword"), p("Hello."))));
  const items: PdfTocItem[] = [];
  if (o.foreword) items.push({ key: "fw", kind: "page", level: 0, title: "Foreword" });
  for (let c = 1; c <= n; c++) {
    const id = `ch-${c}`;
    pages.push({
      id,
      title: `Chapter ${c}`,
      doc: doc(
        h(1, `Chapter ${c}`),
        ...headings.map(([l, t]) => h(l, t)),
        ...filler(o.paragraphs ?? 8),
      ),
    });
    items.push({ key: id, kind: "page", level: 0, title: `Chapter ${c}`, entryId: id });
    // index 0 is the chapter's own h1, which `extractOutline` lists too
    const seen = new Map<string, number>();
    [[1, `Chapter ${c}`] as [number, string], ...headings].forEach(([level, text], index) => {
      const base = `${id}#${level}:${text.toLowerCase()}`;
      const nth = seen.get(base) ?? 0;
      seen.set(base, nth + 1);
      items.push({
        key: `${base}:${nth}`,
        kind: "heading",
        level,
        title: text,
        entryId: id,
        index,
      });
    });
  }
  return { book: { title: "Quay", author: "A. Author", language: "en" }, pages, items };
}

export const itemsAtDepth = (items: PdfTocItem[], depth: number): PdfTocItem[] =>
  items.filter((i) => i.kind === "page" || i.level <= depth);

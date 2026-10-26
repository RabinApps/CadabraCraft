import type { ChapterDoc } from "@cadabracraft/shared";

/** Print preview helpers. The preview is an approximation: the PDF from Typst is the reference. */

export interface Margins { top: number; bottom: number; inside: number; outside: number }

/** Words on a 5.5 x 8.5 in page at 11 pt with the Classic Novel margins (1.55 in across, 1.7 in down): a rough baseline. */
const BASE_WORDS = 250;
const BASE_AREA = (5.5 - 0.9 - 0.65) * (8.5 - 0.8 - 0.9);

/** Rough words per page for a trim size, margins and body size. */
export function wordsPerPage(trim: { w: number; h: number }, margins: Margins, fontSizePt: number): number {
  const area = (trim.w - margins.inside - margins.outside) * (trim.h - margins.top - margins.bottom);
  return Math.max(50, Math.round(BASE_WORDS * (area / BASE_AREA) * (11 / fontSizePt) ** 2));
}

/** Estimated page count: words divided by words per page, plus half a page per chapter that starts on a new page. */
export function estimatePages(words: number, chapters: number, perPage: number): number {
  if (words === 0) return 0;
  return Math.ceil(words / perPage + chapters / 2);
}

interface Node { type?: unknown; text?: unknown; content?: unknown }
const BLOCKS = new Set(["paragraph", "heading", "blockquote"]);

const textOf = (n: Node): string => {
  if (typeof n.text === "string") return n.text;
  return Array.isArray(n.content) ? (n.content as Node[]).map(textOf).join("") : "";
};

/** The text of each paragraph, heading and quote in a chapter, in order. Empty blocks are skipped. */
export function plainBlocks(doc: ChapterDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (typeof n.type === "string" && BLOCKS.has(n.type)) {
        const s = textOf(n).trim();
        if (s) out.push(s);
      } else if (Array.isArray(n.content)) {
        walk(n.content as Node[]);
      }
    }
  };
  walk(doc.content as unknown as Node[]);
  return out;
}

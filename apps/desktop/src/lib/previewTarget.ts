import type { PageReport } from "@cadabracraft/export-pdf";

/**
 * A place in the book's text: a page entry, then a top-level block of it, the leaf of that block (a paragraph of a quote, an item of a
 * list: the report's own count, blank paragraphs the exporter skips not counted), then optionally a word of that leaf.
 */
export interface PreviewTarget {
  id: string;
  block: number;
  leaf: number;
  word: number | null;
  /** The page begins this many characters into the word (it was hyphenated); absent at its first character. */
  char?: number;
}

/**
 * Where the text at the top of physical page `page` of the print PDF is, from the page report of a run with `blockMarks`, so the
 * preview can open the editor there. The first leaf that starts on the page (or the word a paragraph runs onto it at) is the
 * target; a page inside a leaf that started earlier gets that leaf. A page no entry owns (a cover, a blank verso) gets the entry
 * after it, or the last one when it is past them all. Null only when the report has no entries.
 */
export function pageTarget(report: PageReport, page: number): PreviewTarget | null {
  const { starts } = report;
  if (starts.length === 0) return null;
  const entry =
    starts.find((s) => page >= s.page && page <= s.end) ??
    starts.find((s) => s.page > page) ??
    starts[starts.length - 1]!;
  if (page < entry.page || page > entry.end) return { id: entry.id, block: 0, leaf: 0, word: null };
  const blocks = report.blocks?.[entry.id] ?? [];
  let before: PreviewTarget | null = null;
  for (const b of blocks) {
    if (b.page === page) return { id: entry.id, block: b.block, leaf: b.leaf, word: null };
    const split = b.splits.find((s) => s.page === page);
    if (split)
      return {
        id: entry.id,
        block: b.block,
        leaf: b.leaf,
        word: split.word,
        ...(split.char === undefined ? {} : { char: split.char }),
      };
    if (b.page < page) before = { id: entry.id, block: b.block, leaf: b.leaf, word: null };
  }
  return before ?? { id: entry.id, block: 0, leaf: 0, word: null };
}

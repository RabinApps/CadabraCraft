import type { PageReport } from "@cadabracraft/export-pdf";

/** A place in the book's text: a page entry, then a top-level block of it, then optionally a word of that (ordinary) paragraph. */
export interface PreviewTarget {
  id: string;
  block: number;
  word: number | null;
}

/**
 * Where the text at the top of physical page `page` of the print PDF is, from the page report of a run with `blockMarks`, so the
 * preview can open the editor there. The first block that starts on the page (or the word a paragraph runs onto it at) is the
 * target; a page inside a block that started earlier gets that block. A page no entry owns (a cover, a blank verso) gets the entry
 * after it, or the last one when it is past them all. Null only when the report has no entries.
 */
export function pageTarget(report: PageReport, page: number): PreviewTarget | null {
  const { starts } = report;
  if (starts.length === 0) return null;
  const entry =
    starts.find((s) => page >= s.page && page <= s.end) ??
    starts.find((s) => s.page > page) ??
    starts[starts.length - 1]!;
  if (page < entry.page || page > entry.end) return { id: entry.id, block: 0, word: null };
  const blocks = report.blocks?.[entry.id] ?? [];
  let before: PreviewTarget | null = null;
  for (const b of blocks) {
    if (b.page === page) return { id: entry.id, block: b.block, word: null };
    const split = b.splits.find((s) => s.page === page);
    if (split) return { id: entry.id, block: b.block, word: split.word };
    if (b.page < page) before = { id: entry.id, block: b.block, word: null };
  }
  return before ?? { id: entry.id, block: 0, word: null };
}

/** A run of page numbers: one page (`from === to`) or a range. */
export interface PageRun {
  from: number;
  to: number;
}

/**
 * Page numbers as runs: 12, 13, 14, 15 become one run 12 to 15 when `collapse` is on (a run of two stays as two pages, as
 * indexes print "12, 13"; three or more become a range). Duplicates are dropped; the input need not be sorted.
 */
export function pageRuns(pages: readonly number[], collapse: boolean): PageRun[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: PageRun[] = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (collapse && last && p === last.to + 1) last.to = p;
    else runs.push({ from: p, to: p });
  }
  return collapse
    ? runs.flatMap((r) => (r.to - r.from === 1 ? [single(r.from), single(r.to)] : [r]))
    : runs;
}

const single = (n: number): PageRun => ({ from: n, to: n });

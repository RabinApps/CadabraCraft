import type { PageReport } from "@cadabracraft/export-pdf";
import type { ExactSource } from "./exactBreaks";

const isArabic = (number: string): boolean => /^\d+$/.test(number);

/** A report with no chapter start says nothing about the book (an empty book, or a test double), so it is not used. */
export const usableReport = (report: PageReport | null): PageReport | null =>
  report && report.total > 0 && report.starts.length > 0 ? report : null;

/**
 * Pages in the book's body as Typst laid it out: from page 1 (the first arabic-numbered page, after any front matter) to the
 * last page, back matter included. A book without numbers counts every page.
 */
export function reportBookPages(report: PageReport): number {
  const first = report.starts.find((s) => s.number === "1");
  return first ? report.total - first.page + 1 : report.total;
}

/** The printed number of the page entry `id` starts on, or null when it is not in the report or is not arabic-numbered. */
export function reportStartNumber(report: PageReport, id: string): number | null {
  const start = report.starts.find((s) => s.id === id);
  return start && isArabic(start.number) ? Number(start.number) : null;
}

/** How many pages the page entry `id` has as Typst laid it out (its first to its last page, a blank verso before it left out), or null when it is not in the report. */
export function reportChapterPages(report: PageReport, id: string): number | null {
  const start = report.starts.find((s) => s.id === id);
  return start ? start.end - start.page + 1 : null;
}

/** The marks Typst reported for the chapter `id` (the report must be of a run with `blockMarks`), or null when there are none. */
export function reportChapterMarks(report: PageReport, id: string): ExactSource | null {
  const start = report.starts.find((s) => s.id === id);
  const blocks = report.blocks?.[id];
  return start && blocks ? { base: start.page, end: start.end, blocks } : null;
}

import type { PageReport } from "@cadabracraft/export-pdf";
import type { ExactSource } from "./exactBreaks";

/** A report with no chapter start says nothing about the book (an empty book, or a test double), so it is not used. */
export const usableReport = (report: PageReport | null): PageReport | null =>
  report && report.total > 0 && report.starts.length > 0 ? report : null;

/** The marks Typst reported for the chapter `id` (the report must be of a run with `blockMarks`), or null when there are none. */
export function reportChapterMarks(report: PageReport, id: string): ExactSource | null {
  const start = report.starts.find((s) => s.id === id);
  const blocks = report.blocks?.[id];
  return start && blocks ? { base: start.page, end: start.end, blocks } : null;
}

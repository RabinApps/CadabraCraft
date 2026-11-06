import { create } from "zustand";
import type { PageReport } from "@cadabracraft/export-pdf";
import { usableReport } from "../../lib/page/pageReport";

/** What the last measure of one chapter on its own said: its breaks (not its page numbers) are the ones of the book. */
export interface ChapterMeasure {
  id: string;
  report: PageReport;
  /** Position in the order the reports arrived (`reportAt` of the book's is the same kind of number). */
  at: number;
}

/**
 * The page layout Typst reported for the book, for the status bar and Page view. `fresh` is false from the moment the book changes
 * until a report for the new text arrives (or when Page view is off, so nothing is measuring), so a stale report is never shown.
 * The open chapter is also measured on its own, much sooner than the book (`chapter`): its breaks inside the chapter are the same.
 */
export const usePageMeasure = create<{
  report: PageReport | null;
  fresh: boolean;
  /** Counts the reports received, so a consumer can tell a new one from the last. */
  version: number;
  /** When the book's report arrived, in the order shared with `chapter.at`. */
  reportAt: number;
  chapter: ChapterMeasure | null;
  /** `chapter` is of the text as it is now. */
  chapterFresh: boolean;
  /** Why the last measure failed (shown nowhere: the estimate is used instead). */
  error: string | null;
}>(() => ({
  report: null,
  fresh: false,
  version: 0,
  reportAt: 0,
  chapter: null,
  chapterFresh: false,
  error: null,
}));

let clock = 0;

export const setMeasured = (report: PageReport): void =>
  usePageMeasure.setState((s) => ({
    report,
    fresh: true,
    version: s.version + 1,
    reportAt: ++clock,
    error: null,
  }));

export const setChapterMeasured = (id: string, report: PageReport): void =>
  usePageMeasure.setState({ chapter: { id, report, at: ++clock }, chapterFresh: true });

export const markMeasureStale = (): void =>
  usePageMeasure.setState((s) =>
    s.fresh || s.chapterFresh ? { ...s, fresh: false, chapterFresh: false } : s,
  );

export const setMeasureError = (error: string): void =>
  usePageMeasure.setState({ fresh: false, error });

type Measures = ReturnType<typeof usePageMeasure.getState>;

/**
 * The newest report that says where the breaks of page entry `id` are, and a number that changes with it: the chapter's own measure
 * or the book's, whichever is newer (the book's only counts when it was measured with marks). Null before the first one. Stale
 * reports are returned too (Page view keeps them until the text moves a block, see `exactBreaks`).
 */
export function breaksReport(s: Measures, id: string): { report: PageReport; at: number } | null {
  const own =
    s.chapter && s.chapter.id === id ? { report: s.chapter.report, at: s.chapter.at } : null;
  const full = usableReport(s.report);
  const book = full?.blocks?.[id] ? { report: full, at: s.reportAt } : null;
  return own && book ? (own.at > book.at ? own : book) : (own ?? book);
}

/** The report of the text as it is now that has page entry `id` (the book's, or the chapter's own), or null when neither is current. */
export function freshReport(s: Measures, id: string): PageReport | null {
  if (s.chapterFresh && s.chapter?.id === id) return s.chapter.report;
  return s.fresh ? usableReport(s.report) : null;
}

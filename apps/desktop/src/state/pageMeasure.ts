import { create } from "zustand";
import type { PageReport } from "@cadabracraft/export-pdf";

/**
 * The page layout Typst reported for the book, for the status bar and Page view. `fresh` is false from the moment the book changes
 * until a report for the new text arrives (or when Page view is off, so nothing is measuring), so a stale report is never shown.
 */
export const usePageMeasure = create<{
  report: PageReport | null;
  fresh: boolean;
  /** Counts the reports received, so a consumer can tell a new one from the last. */
  version: number;
  /** Why the last measure failed (shown nowhere: the estimate is used instead). */
  error: string | null;
}>(() => ({ report: null, fresh: false, version: 0, error: null }));

export const setMeasured = (report: PageReport): void =>
  usePageMeasure.setState((s) => ({ report, fresh: true, version: s.version + 1, error: null }));

export const markMeasureStale = (): void =>
  usePageMeasure.setState((s) => (s.fresh ? { ...s, fresh: false } : s));

export const setMeasureError = (error: string): void =>
  usePageMeasure.setState({ fresh: false, error });

import { useEffect } from "react";
import {
  markMeasureStale,
  setMeasured,
  setMeasureError,
  usePageMeasure,
} from "../../state/pageMeasure";
import { useProject } from "../../state/project/index";
import { errText } from "../../lib/projectError";

/** How long the book must be unchanged before Typst is asked about it (a measure takes seconds for a book). */
export const MEASURE_DELAY_MS = 2000;

/**
 * Keeps `usePageMeasure` current while Page view is on: after the book has been still for `MEASURE_DELAY_MS` it asks Typst where
 * each chapter starts (at once the first time, when there is nothing to show yet). Any change to the book marks the last report
 * stale at once. A failure (Typst not installed, say) leaves the word-count estimate in place and is not shown. `marks` asks for
 * the page marks too (Read mode draws every chapter's breaks; Page view gets the open chapter's from `useMeasuredChapter`).
 */
export function useMeasuredPages(enabled: boolean, marks = false): void {
  const measure = useProject((s) => s.actions.measurePages);
  const manifest = useProject((s) => s.manifest);
  const hashes = useProject((s) => s.hashes);
  const draft = useProject((s) => s.draft);
  const currentDoc = useProject((s) => s.currentDoc);
  const busy = useProject((s) => s.exportStage !== null);
  useEffect(() => {
    markMeasureStale();
    if (!enabled || !manifest || busy) return;
    let live = true;
    const last = usePageMeasure.getState().report;
    const first = last === null || (marks && !last.blocks);
    const timer = setTimeout(
      () => {
        measure({ marks }).then(
          (report) => live && setMeasured(report),
          (e) => live && setMeasureError(errText(e)),
        );
      },
      first ? 0 : MEASURE_DELAY_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, marks, manifest, hashes, draft, currentDoc, busy, measure]);
}

import { useEffect } from "react";
import { markMeasureStale, setMeasured, setMeasureError } from "../../state/pageMeasure";
import { useProject } from "../../state/project/index";
import { errText } from "../../lib/projectError";

/** How long the book must be unchanged before Typst is asked about it (a measure takes seconds for a book). */
export const MEASURE_DELAY_MS = 2000;

/**
 * Keeps `usePageMeasure` current while Page view is on: after the book has been still for `MEASURE_DELAY_MS` it asks Typst where
 * each chapter starts. Any change to the book marks the last report stale at once. A failure (Typst not installed, say) leaves the
 * word-count estimate in place and is not shown.
 */
export function useMeasuredPages(enabled: boolean): void {
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
    const timer = setTimeout(() => {
      measure().then(
        (report) => live && setMeasured(report),
        (e) => live && setMeasureError(errText(e)),
      );
    }, MEASURE_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, manifest, hashes, draft, currentDoc, busy, measure]);
}

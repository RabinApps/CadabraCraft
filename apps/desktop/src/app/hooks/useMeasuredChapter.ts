import { useEffect } from "react";
import { setChapterMeasured, usePageMeasure } from "../../state/pageMeasure";
import { useProject } from "../../state/project/index";

/** How long the open chapter must be unchanged before it is measured on its own (the whole book waits longer, see `MEASURE_DELAY_MS`). */
export const CHAPTER_MEASURE_DELAY_MS = 500;

/**
 * Measures page entry `id` on its own with Typst while Page view is on, so its page breaks are exact a moment after it was opened or
 * edited instead of after the whole book has been typeset. The layout inside a chapter does not depend on the pages before it. A
 * failure is ignored: the book's measure (or the estimate) stays.
 */
export function useMeasuredChapter(enabled: boolean, id: string | null): void {
  const measure = useProject((s) => s.actions.measureChapter);
  const manifest = useProject((s) => s.manifest);
  const hashes = useProject((s) => s.hashes);
  const draft = useProject((s) => s.draft);
  const currentDoc = useProject((s) => s.currentDoc);
  const busy = useProject((s) => s.exportStage !== null);
  useEffect(() => {
    if (!enabled || !id || !manifest || busy) return;
    let live = true;
    // Nothing known about this chapter yet: no waiting.
    const known = usePageMeasure.getState().chapter?.id === id;
    const timer = setTimeout(
      () => {
        measure(id).then(
          (report) => live && setChapterMeasured(id, report),
          () => undefined,
        );
      },
      known ? CHAPTER_MEASURE_DELAY_MS : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, id, manifest, hashes, draft, currentDoc, busy, measure]);
}

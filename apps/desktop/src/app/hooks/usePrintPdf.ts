import { useEffect, useState } from "react";
import type { TrimSize } from "@cadabracraft/export-pdf";
import { errText } from "../../lib/projectError";
import { useProject } from "../../state/project/index";

/** How long the choices must stay the same before Typst is asked: flipping through trim sizes does not start a run each time. */
export const PREVIEW_DELAY_MS = 250;

export interface PrintPdfState {
  /** The latest PDF; kept while the next one is typeset so the page does not flash empty. */
  pdf: Uint8Array | null;
  loading: boolean;
  /** Why the latest run failed (Typst missing, a compile error); the preview then falls back to an estimate. */
  error: string | null;
}

/**
 * The real print PDF for the preview: typesets the book with Typst whenever the trim size, bleed or crop marks change (the store
 * caches the last few results, so going back is instant) and returns the state for a loading indicator, the pages, or the fallback.
 */
export function usePrintPdf(options: {
  trimSize: TrimSize;
  bleedIn: number;
  cropMarks: boolean;
}): PrintPdfState {
  const render = useProject((s) => s.actions.renderPreview);
  const [state, setState] = useState<PrintPdfState>({ pdf: null, loading: true, error: null });
  const { trimSize, bleedIn, cropMarks } = options;
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      render({ trimSize, bleedIn, cropMarks }).then(
        (pdf) => live && setState({ pdf, loading: false, error: null }),
        (e: unknown) => live && setState({ pdf: null, loading: false, error: errText(e) }),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [render, trimSize, bleedIn, cropMarks]);
  return state;
}

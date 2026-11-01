import { useEffect, useMemo, useRef, useState } from "react";
import { contentHash } from "@cadabracraft/export-audio";
import { createPreviewJob, type JobState, type PreviewJob } from "../../lib/previewJob";
import {
  approxKey,
  approxPages,
  previewDelay,
  type ContentsLayout,
  type PreviewLine,
  type PreviewPage,
} from "../../lib/tocPreview";
import { useProject } from "../../state/project/index";
import type { ContentsPreview } from "../../state/project/types";

/** What the preview shows: Typst's own pages, or the approximation drawn from the same list. */
export type ApproxResult = {
  kind: "approx";
  key: string;
  title: string;
  rtl: boolean;
  layout: ContentsLayout;
  pages: PreviewPage[];
};
export type PreviewResult = Extract<ContentsPreview, { kind: "typst" }> | ApproxResult;

export interface ApproxInput {
  title: string;
  lines: PreviewLine[];
  layout: ContentsLayout;
  /** Front-matter pages ahead of the contents page (for the folios of the continuation cards). */
  before: number;
  rtl: boolean;
}

export interface TocPreviewState extends JobState<PreviewResult> {
  /** Typst is not installed: the preview is the approximation (known after the first try). */
  fallback: boolean;
  retry: () => void;
}

/**
 * The contents preview of the open Contents page. While `active` (the pane is on screen) the contents page is typeset by Typst after
 * the book has been still for a moment; if Typst is not installed the same list is laid out as HTML (and then redrawn after a much
 * shorter wait). Results that arrive after a newer request are dropped, a failure keeps the last page on screen, and nothing runs
 * while the pane is hidden.
 */
export function useTocPreview(active: boolean, approx: ApproxInput): TocPreviewState {
  const render = useProject((s) => s.actions.renderContentsPreview);
  const manifest = useProject((s) => s.manifest);
  const hashes = useProject((s) => s.hashes);
  const [state, setState] = useState<JobState<PreviewResult>>({
    status: "idle",
    result: null,
    key: null,
    error: null,
  });
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The latest list for the run that is made later (and not for the one that was asked for).
  const latest = useRef(approx);
  const unavailable = useRef(false);
  const [job] = useState<PreviewJob<PreviewResult>>(() =>
    createPreviewJob<PreviewResult>({
      run: async () => {
        if (!unavailable.current) {
          const typeset = await render();
          if (typeset.kind === "typst") return typeset;
          unavailable.current = true;
          setFallback(true);
        }
        const a = latest.current;
        return {
          kind: "approx",
          key: approxKey(a),
          title: a.title,
          rtl: a.rtl,
          layout: a.layout,
          pages: approxPages(a.lines, a.layout, a.before),
        };
      },
      keyOf: (r) => (r.kind === "approx" ? r.key : undefined),
      onChange: setState,
    }),
  );
  useEffect(() => {
    latest.current = approx;
  });
  const key = useMemo(() => approxKey(approx), [approx]);
  // What Typst sees changes with the book: the manifest (the list's settings, titles, order) and the saved text of any page.
  const book = useMemo(() => contentHash(JSON.stringify([manifest, hashes])), [manifest, hashes]);
  // Once Typst is known to be missing the list itself is the thing to watch (the book changing without the list changing draws nothing).
  const watch = fallback ? key : `book:${book}`;
  useEffect(() => {
    if (!active) {
      job.cancel();
      return;
    }
    const s = job.state();
    const delay =
      s.status === "error" ? 0 : previewDelay({ first: s.result === null, typst: !fallback });
    job.schedule(delay, watch);
  }, [job, active, fallback, watch, attempt]);
  useEffect(() => () => job.cancel(), [job]);
  return { ...state, fallback, retry: () => setAttempt((n) => n + 1) };
}

import { useEffect, useMemo, useState } from "react";
import {
  resolveToc,
  staleOverrides,
  tocSettingsOf,
  type EditionEntry,
  type Outlines,
} from "@cadabracraft/format";
import { estimateStarts, needsOutlines, tocRows } from "../../lib/tocView";
import { usableReport } from "../../lib/pageReport";
import { usePageMeasure } from "../../state/pageMeasure";
import { useProject } from "../../state/project/index";
import { useMeasuredPages } from "../hooks/useMeasuredPages";

const NONE: Outlines = {};

/**
 * Everything the contents editor shows for one contents page: the resolved list (it follows the book: a chapter added, renamed,
 * moved or trashed, or a heading edited, changes it), the page numbers (Typst's report while the book is measured, else the
 * word-count estimate) and the overrides that no longer match. Heading numbers need the page marks, so the book is measured with
 * them only while headings are listed.
 */
export function useToc(entry: EditionEntry) {
  const manifest = useProject((s) => s.manifest)!;
  const hashes = useProject((s) => s.hashes);
  const language = useProject((s) => s.activeLanguage ?? s.manifest!.editions[0]!.language);
  const actions = useProject((s) => s.actions);
  const settings = tocSettingsOf(entry);
  const [outlines, setOutlines] = useState<Outlines | null>(null);
  const [estimates, setEstimates] = useState<Record<string, number>>({});
  useMeasuredPages(true, settings.depth > 0);
  const report = usePageMeasure((s) => usableReport(s.report));
  const current = usePageMeasure((s) => s.fresh);
  // The headings of every page, read again when the book or any page's saved text changes.
  const wanted = needsOutlines(settings);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    actions.tocOutlines().then(
      (o) => live && setOutlines(o),
      () => live && setOutlines({}),
    );
    return () => {
      live = false;
    };
  }, [wanted, manifest, hashes, language, actions]);
  useEffect(() => {
    let live = true;
    actions.chapterWordsBefore("").then(
      (words) =>
        live &&
        setEstimates(
          estimateStarts(
            manifest,
            manifest.chapters.map((c) => c.id),
            words,
          ),
        ),
      () => live && setEstimates({}),
    );
    return () => {
      live = false;
    };
  }, [manifest, hashes, actions]);
  const known = outlines ?? NONE;
  const items = useMemo(
    () => resolveToc(manifest, entry, language, known),
    [manifest, entry, language, known],
  );
  // Stale means "points at nothing in the whole outline": judged against every heading level, and only once the headings are read.
  const stale = useMemo(() => {
    if (wanted && outlines === null) return [];
    const all = resolveToc(manifest, { ...entry, toc: { ...settings, depth: 3 } }, language, known);
    return staleOverrides(entry, all);
  }, [manifest, entry, settings, language, outlines, known, wanted]);
  const rows = useMemo(() => {
    const dangling = new Set(stale.filter((s) => s.kind === "custom").map((s) => s.key));
    const shown = items.map((i) =>
      i.kind === "custom" ? { ...i, stale: dangling.has(i.key) } : i,
    );
    return tocRows(shown, { report, current, estimates, outlines: known });
  }, [items, stale, report, current, estimates, known]);
  return { settings, items, rows, stale, language };
}

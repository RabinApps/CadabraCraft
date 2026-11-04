import { useEffect, useMemo, useState } from "react";
import {
  resolveToc,
  staleOverrides,
  tocSettingsOf,
  type EditionEntry,
  type Outlines,
} from "@cadabracraft/format";
import { needsOutlines, tocRows, type TocNumber } from "../../lib/tocView";
import { usableReport } from "../../lib/pageReport";
import { usePageMeasure } from "../../state/pageMeasure";
import { useProject } from "../../state/project/index";
import { useBookLayout } from "../hooks/useBookLayout";
import { useMeasuredPages } from "../hooks/useMeasuredPages";

const NONE: Outlines = {};

/**
 * Everything the contents editor shows for one contents page: the resolved list (it follows the book: a chapter added, renamed,
 * moved or trashed, or a heading edited, changes it), the page numbers (Typst's report while the book is measured, else the
 * word-count estimate) and the overrides that no longer match. Heading numbers need the page marks, so the book is measured with
 * them only while headings are listed. `measure` false leaves the measuring to a caller that already does it (Read mode).
 */
export function useToc(entry: EditionEntry, measure = true) {
  const manifest = useProject((s) => s.manifest)!;
  const hashes = useProject((s) => s.hashes);
  const language = useProject((s) => s.activeLanguage ?? s.manifest!.editions[0]!.language);
  const actions = useProject((s) => s.actions);
  const settings = tocSettingsOf(entry);
  const [outlines, setOutlines] = useState<Outlines | null>(null);
  const layout = useBookLayout();
  useMeasuredPages(measure, settings.depth > 0);
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
  // The numbers the book layout prints for every entry: roman in the front matter, arabic from chapter 1 on. Built once per layout,
  // so the list, the preview and Read mode all show the number the page will print.
  const numbers = useMemo(() => {
    const out: Record<string, TocNumber> = {};
    for (const e of layout?.entries ?? [])
      out[e.id] = { text: e.folio === "" ? null : e.folio, estimated: !e.exact };
    return out;
  }, [layout]);
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
    return tocRows(shown, { report, current, numbers, outlines: known });
  }, [items, stale, report, current, numbers, known]);
  return { settings, items, rows, stale, language, layout };
}

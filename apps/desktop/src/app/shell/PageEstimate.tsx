import { useEffect, useMemo, useState } from "react";
import { sectionOf } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { bookPages } from "../../lib/bookPages";
import { trimLabel } from "../../lib/trimLabels";
import { usePageCount } from "../../state/pageCount";
import { useProject } from "../../state/project/index";

/**
 * " · ≈ 170 pages at 6 × 9 in": the status bar's page count at the book's trim size, counted like Page view (per chapter, with
 * right-hand starts), using the measured pages for the open chapter while Page view is on. The "≈" shows while any chapter is only
 * estimated from its words. Renders nothing for an empty book. `words` (the book's total) is when to count again.
 */
export function PageEstimate({ words }: { words: number | null }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const chapterWords = useProject((s) => s.actions.chapterWordsBefore);
  const measuredPages = usePageCount((s) => s.count);
  const [counts, setCounts] = useState<{ words: number[]; open: number | null }>({
    words: [],
    open: null,
  });
  useEffect(() => {
    if (!manifest || !words) return setCounts({ words: [], open: null });
    let live = true;
    const isChapter = currentId !== null && sectionOf(manifest, currentId) === "chapter";
    Promise.all([chapterWords(""), isChapter ? chapterWords(currentId) : null])
      .then(([all, before]) => live && setCounts({ words: all, open: before && before.length }))
      .catch(() => live && setCounts({ words: [], open: null }));
    return () => {
      live = false;
    };
  }, [manifest, words, currentId, chapterWords]);
  const estimate = useMemo(() => {
    if (!manifest || !words || counts.words.length === 0) return null;
    const measured =
      counts.open !== null && measuredPages > 0
        ? new Map([[counts.open, measuredPages]])
        : undefined;
    return bookPages(manifest, counts.words, measured);
  }, [manifest, words, counts, measuredPages]);
  if (!estimate) return null;
  const size = trimLabel(estimate.trimSize);
  const pages = estimate.exact
    ? plural(estimate.pages, { one: "# page", other: "# pages" })
    : plural(estimate.pages, { one: "≈ # page", other: "≈ # pages" });
  return <>{` · ${pages} ${t`at ${size}`}`}</>;
}

/** " · Page 3 of ≈ 12": where the cursor is among the open chapter's pages while Page view is on (measured from the text, so approximate). */
export function PagePosition() {
  const { t } = useLingui();
  const { count, current } = usePageCount();
  if (count === 0) return null;
  return <span data-testid="page-position">{` · ${t`Page ${current} of ≈ ${count}`}`}</span>;
}

import { useMemo } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { bookPages } from "../../lib/bookPages";
import { trimLabel } from "../../lib/trimLabels";
import { usePageCount } from "../../state/pageCount";
import { useProject } from "../../state/project/index";

/** " · ≈ 170 pages at 6 × 9 in": the status bar's page estimate at the book's trim size (word count based, so approximate). Renders nothing for an empty book. */
export function PageEstimate({ words }: { words: number | null }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const estimate = useMemo(
    () => (manifest && words ? bookPages(manifest, words) : null),
    [manifest, words],
  );
  if (!estimate) return null;
  const size = trimLabel(estimate.trimSize);
  const pages = plural(estimate.pages, { one: "≈ # page", other: "≈ # pages" });
  return <>{` · ${pages} ${t`at ${size}`}`}</>;
}

/** " · Page 3 of ≈ 12": where the cursor is among the open chapter's pages while Page view is on (measured from the text, so approximate). */
export function PagePosition() {
  const { t } = useLingui();
  const { count, current } = usePageCount();
  if (count === 0) return null;
  return <span data-testid="page-position">{` · ${t`Page ${current} of ≈ ${count}`}`}</span>;
}

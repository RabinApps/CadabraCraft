import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { folioAt, formatFolio } from "@cadabracraft/shared";
import { resolveTrimSize } from "@cadabracraft/templates";
import { trimLabel } from "../../lib/trimLabels";
import { usePageCount } from "../../state/pageCount";
import { useProject } from "../../state/project/index";
import { useBookLayout } from "../hooks/useBookLayout";
import { useMeasuredPages } from "../hooks/useMeasuredPages";
import { usePageView } from "../hooks/usePageView";

/**
 * " · 174 pages at 6 × 9 in": the status bar's page count at the book's trim size, from the book's layout (front matter, chapters
 * and back matter, blank pages included; see `lib/pageNumbering.ts`). The "≈" shows while any page count is only estimated from
 * its words or an editor's layout. Renders nothing for an empty book or while the words are first counted.
 */
export function PageEstimate() {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const pageView = usePageView();
  // The book's measure is what makes the numbers exact: it runs while Page view is on.
  useMeasuredPages(pageView.on);
  const layout = useBookLayout();
  if (!manifest || !layout || layout.physical === 0) return null;
  const size = trimLabel(resolveTrimSize(manifest));
  const pages = layout.exact
    ? plural(layout.physical, { one: "# page", other: "# pages" })
    : plural(layout.physical, { one: "≈ # page", other: "≈ # pages" });
  return <>{` · ${pages} ${t`at ${size}`}`}</>;
}

/**
 * " · Page 7 of 174": where the cursor is in the book while Page view is on: the number the book gives the page under the cursor
 * (roman in the front matter, arabic from chapter 1 on, blank pages included) and the book's last page. The "≈" before the number
 * means an entry before it is only estimated from its words, so the number may still move; whether the page breaks are the PDF's
 * is the page chip's business ("approximate" or "breaks as in the PDF"). The "≈" on the total means some entry's count is still
 * an estimate.
 */
export function PagePosition() {
  const { t } = useLingui();
  const { count, current } = usePageCount();
  const currentId = useProject((s) => s.currentId);
  const layout = useBookLayout();
  if (count === 0 || !layout) return null;
  const placed = currentId ? layout.byId.get(currentId) : undefined;
  if (!placed) return null;
  // The card the cursor is on, as a physical page of the book: its number is the one the PDF prints there.
  const at = folioAt(layout, placed.cardStart + Math.min(current, count) - 1);
  const shown = formatFolio(at.number, at.style);
  // The number is the book's own for this page: it is certain once every entry before it is measured (or Typst placed it).
  const text = placed.startExact
    ? t`Page ${shown} of ${layout.physical}`
    : layout.exact
      ? t`Page ≈ ${shown} of ${layout.physical}`
      : t`Page ${shown} of ≈ ${layout.physical}`;
  return <span data-testid="page-position">{` · ${text}`}</span>;
}

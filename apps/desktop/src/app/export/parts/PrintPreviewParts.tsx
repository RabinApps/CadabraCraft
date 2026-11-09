import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { PenLine } from "lucide-react";
import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import { errText } from "../../../lib/projectError";
import { trimLabel } from "../../../lib/export/trimLabels";
import type { WordClick } from "../../../lib/export/pdfWords";
import { Button } from "../../../ui/Button";
import { Select } from "../../../ui/forms/Select";
import { Switch } from "../../../ui/forms/Switch";
import { Notice } from "../../../ui/feedback/Notice";
import { useProject, type BookPage } from "../../../state/project/index";
import { setBleed, setCropMarks } from "../../../state/pages/printSetup";
import { requestPreviewJump } from "../../../state/pages/previewJump";
import { useViewMode } from "../../../state/view/viewMode";
import { CoverThumb } from "../ApproxSpread";

/** What a click on a page of the preview needs to find the text again in the chapter. */
interface OpenPageContext {
  trimSize: TrimSize;
  bleedIn: number;
  cropMarks: boolean;
  /** Leaves the preview once the editor is showing the chapter. */
  onBack: () => void;
}

/** A page of the preview opens its chapter in the editor, at the word that was clicked, else at the text that starts the page. */
export function useOpenPreviewPage({ trimSize, bleedIn, cropMarks, onBack }: OpenPageContext) {
  const { t } = useLingui();
  /** The first page of the spread on screen, reported by the spread; Edit this page opens it. */
  const [pageInView, setPageInView] = useState(1);
  const previewTarget = useProject((s) => s.actions.previewTarget);
  const selectChapter = useProject((s) => s.actions.selectChapter);
  const setMode = useViewMode((s) => s.setMode);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const openPage = (page: number, click: WordClick | null) => {
    setOpening(true);
    setOpenError("");
    (async () => {
      const target = await previewTarget({ trimSize, bleedIn, cropMarks, page });
      if (!target) return setOpenError(t`That page is not in the book.`);
      requestPreviewJump(target, click ?? undefined);
      await selectChapter(target.id);
      setMode("write");
      onBack();
    })()
      .catch((e: unknown) => setOpenError(errText(e)))
      .finally(() => setOpening(false));
  };
  const editPage = { disabled: opening, open: () => openPage(pageInView, null) };
  return { opening, openError, openPage, setPageInView, editPage };
}

/** The strip of page thumbnails beside the estimate (shown only while the real layout is not). */
export function PagesRail({
  root,
  cover,
  pages,
}: {
  root: string | null;
  cover: string | null | undefined;
  pages: BookPage[] | null;
}) {
  return (
    <aside className="hidden w-35 shrink-0 flex-col items-center gap-3 overflow-y-auto bg-sidebar p-4 md:flex">
      {root && cover && <CoverThumb root={root} cover={cover} />}
      {(pages ?? []).slice(0, 6).map((p, i) => (
        <div key={p.id} className="flex flex-col items-center gap-1.5" aria-hidden>
          <div className="flex h-28 w-21 flex-col gap-1.5 rounded-sm border border-border bg-paper p-3">
            <span className="h-1.5 w-8 rounded-full bg-ink-muted" />
            {Array.from({ length: 5 }, (_, n) => (
              <span key={n} className="h-px w-full bg-border" />
            ))}
          </div>
          <span className="text-xs text-ink-muted">{i + 1}</span>
        </div>
      ))}
    </aside>
  );
}

/** The progress and error lines above the pages. */
export function PreviewNotices({
  loading,
  opening,
  openError,
  error,
}: {
  /** Typst is typesetting the preview. */
  loading: boolean;
  opening: boolean;
  openError: string;
  /** Why the real layout could not be typeset. */
  error: string | null | undefined;
}) {
  const { t } = useLingui();
  return (
    <>
      {loading && (
        <div className="flex flex-col gap-2 border-b border-border bg-surface px-4 py-2">
          <p role="status" className="text-sm text-ink-muted">
            {t`Typesetting the preview with Typst…`}
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden>
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
          </div>
        </div>
      )}
      {opening && (
        <p
          role="status"
          className="border-b border-border bg-surface px-4 py-2 text-sm text-ink-muted"
        >
          {t`Finding the page in your chapter…`}
        </p>
      )}
      {openError && (
        <Notice role="alert" className="m-4 whitespace-pre-wrap wrap-break-word">
          {openError}
        </Notice>
      )}
      {error && !loading && (
        <Notice role="alert" className="m-4 whitespace-pre-wrap wrap-break-word">
          {t`Showing an approximate layout, because the real one could not be typeset:`} {error}
        </Notice>
      )}
    </>
  );
}

/** The "Page setup" sidebar: trim size, bleed, page count, cover note and the margin and crop mark switches. */
export function PageSetup({
  editPage,
  trim,
  onTrim,
  bleed,
  real,
  pdfPages,
  estimate,
  hasCover,
  showMargins,
  onShowMargins,
  cropMarks,
}: {
  trim: TrimSize;
  onTrim: (t: TrimSize) => void;
  bleed: boolean;
  /** The pages come from the real Typst layout rather than the estimate. */
  real: boolean;
  pdfPages: number;
  estimate: number;
  hasCover: boolean;
  showMargins: boolean;
  onShowMargins: (on: boolean) => void;
  cropMarks: boolean;
  /** Opens the editor at the page in view. */
  editPage: { disabled: boolean; open: () => void };
}) {
  const { t } = useLingui();
  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-border bg-surface p-5 lg:w-75 lg:overflow-y-auto lg:border-s lg:border-t-0">
      <h2 className="font-book text-lg font-semibold">{t`Page setup`}</h2>
      <Select
        label={t`Trim size`}
        value={trim}
        onChange={(e) => onTrim(e.target.value as TrimSize)}
      >
        {(Object.keys(TRIM_SIZES) as TrimSize[]).map((id) => (
          <option key={id} value={id}>
            {trimLabel(id)}
          </option>
        ))}
      </Select>
      <Select
        label={t`Bleed`}
        value={bleed ? "kdp" : "none"}
        onChange={(e) => setBleed(e.target.value === "kdp")}
        hint={t`The PDF gets the same bleed and crop marks. Set them here or in the export dialog.`}
      >
        <option value="none">{t`None`}</option>
        <option value="kdp">{t`0.125 in`}</option>
      </Select>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-ink-muted">{t`Pages`}</span>
        <span className="text-sm font-medium" data-testid="page-count">
          {real && pdfPages > 0
            ? plural(pdfPages, { one: "# page in the PDF", other: "# pages in the PDF" })
            : estimate === 0
              ? t`No text yet`
              : plural(estimate, { one: "About # page", other: "About # pages" })}
        </span>
      </div>
      {hasCover && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">{t`Cover`}</span>
          <span className="text-sm">
            {real
              ? t`The cover is the first page, with a blank page behind it, unless you turn it off in the export dialog.`
              : t`Added as the first page, with a blank page behind it, unless you turn it off in the export dialog. The page count above does not include them.`}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{t`Show margins`}</span>
        <Switch label={t`Show margins`} checked={showMargins} onChange={onShowMargins} />
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{t`Crop marks`}</span>
        <Switch label={t`Crop marks`} checked={cropMarks} onChange={setCropMarks} />
      </div>
      <Button icon={PenLine} disabled={editPage.disabled} onClick={editPage.open}>
        {t`Edit this page`}
      </Button>
    </aside>
  );
}

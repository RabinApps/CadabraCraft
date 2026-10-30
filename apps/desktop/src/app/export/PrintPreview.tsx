import { sourceEdition } from "@cadabracraft/format";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { ArrowLeft, BookOpen, Printer } from "lucide-react";
import { TRIM_SIZES, pageBox, type TrimSize } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { countWords } from "@cadabracraft/shared";
import { errText } from "../../lib/projectError";
import { bookPageCount } from "../../lib/pageNumbering";
import { plainBlocks } from "../../lib/printEstimate";
import { trimLabel } from "../../lib/trimLabels";
import { Button, IconButton } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import type { ExportFormat } from "./exportFormat";
import { useProject, type BookPage } from "../../state/project/index";
import { Notice } from "../../ui/Notice";
import { bleedInches, setBleed, setCropMarks, usePrintSetup } from "../../state/printSetup";
import { usePrintPdf } from "../hooks/usePrintPdf";
import type { WordClick } from "../../lib/pdfWords";
import { requestPreviewJump } from "../../state/previewJump";
import { useViewMode } from "../../state/viewMode";
import { ApproxPage, CoverThumb } from "./ApproxSpread";
import { TypstSpread } from "./TypstSpread";

/** Width of one estimated page in px (the fallback when Typst cannot run). Height and everything inside are scaled from the trim size against it. */
const PAGE_PX = 300;
/** Blocks shown per estimated page before the text is clipped. */
const BLOCKS_PER_PAGE = 7;

interface Props {
  onBack: () => void;
  onExport: (format: ExportFormat) => void;
}

/**
 * Print preview: the book typeset by Typst, the same run as the PDF export (so the page breaks, fonts, bleed and crop marks are the real
 * ones), drawn page by page with pdf.js. While Typst works, or when it cannot run (it is missing, or the book does not compile), the page
 * shows an estimate drawn from the template instead, and says why.
 */
export function PrintPreview({ onBack, onExport }: Props) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const root = useProject((s) => s.root);
  const readPages = useProject((s) => s.actions.readPages);
  const activeLanguage = useProject((s) => s.activeLanguage);
  const activeEdition =
    manifest?.editions.find((e) => e.language === activeLanguage) ??
    sourceEdition(manifest!.editions);
  const [pages, setPages] = useState<BookPage[] | null>(null);
  const [error, setError] = useState("");
  const { bleed, cropMarks } = usePrintSetup();
  const [showMargins, setShowMargins] = useState(true);
  const template = getTemplate(
    manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID,
  );
  const [trim, setTrim] = useState<TrimSize>(
    resolveTrimSize({
      template: template.id,
      ...(manifest?.trimSize ? { trimSize: manifest.trimSize } : {}),
    }),
  );
  const bleedIn = bleedInches(bleed);
  const typeset = usePrintPdf({ trimSize: trim, bleedIn, cropMarks });
  const previewTarget = useProject((s) => s.actions.previewTarget);
  const selectChapter = useProject((s) => s.actions.selectChapter);
  const setMode = useViewMode((s) => s.setMode);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [pdfPages, setPdfPages] = useState(0);
  const onPages = useCallback((n: number) => setPdfPages(n), []);
  // A page of the preview opens its chapter in the editor, at the word that was clicked, else at the text that starts the page.
  const openPage = (page: number, click: WordClick | null) => {
    setOpening(true);
    setOpenError("");
    (async () => {
      const target = await previewTarget({ trimSize: trim, bleedIn, cropMarks, page });
      if (!target) return setOpenError(t`That page is not in the book.`);
      requestPreviewJump(target, click ?? undefined);
      await selectChapter(target.id);
      setMode("write");
      onBack();
    })()
      .catch((e: unknown) => setOpenError(errText(e)))
      .finally(() => setOpening(false));
  };
  useEffect(() => {
    readPages().then(setPages, (e: unknown) => setError(errText(e)));
  }, [readPages]);
  // Counting walks every page's document; only redo it when the pages are read again, not on each option change.
  const chapterWords = useMemo(
    () => (pages ?? []).filter((p) => p.section === "chapter").map((p) => countWords(p.doc)),
    [pages],
  );

  if (!manifest) return null;
  const size = TRIM_SIZES[trim];
  const margins = template.print.defaults.marginsIn;
  const box = pageBox(size, margins, true, { bleedIn, cropMarks });
  const scale = PAGE_PX / size.w; // px per inch
  const heightPx = PAGE_PX * (size.h / size.w);
  const estimate = bookPageCount({ template: template.id, trimSize: trim }, chapterWords).pages;
  const first = (pages ?? []).find((p) => p.section === "chapter") ?? pages?.[0];
  const blocks = first ? plainBlocks(first.doc).filter((b) => b !== first.title) : [];
  const bodyFont = /serif/i.test(template.print.bodyFonts[0] ?? "")
    ? "var(--font-book)"
    : "var(--font-ui)";
  const pageProps = {
    template,
    margins,
    scale,
    widthPx: PAGE_PX,
    heightPx,
    showMargins,
    cropMarks,
    bodyFont,
    bleedPx: bleedIn * scale,
  };
  const hasCover = activeEdition.cover != null;
  const real = typeset.pdf !== null;

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
          <h1 className="truncate font-book text-base font-semibold">{t`Print preview`}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={BookOpen} onClick={() => onExport("epub")}>{t`Export EPUB`}</Button>
          <Button
            variant="primary"
            icon={Printer}
            onClick={() => onExport("pdf")}
          >{t`Export PDF`}</Button>
        </div>
      </header>
      {error && (
        <Notice role="alert" className="m-4">
          {error}
        </Notice>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {!real && (
          <aside className="hidden w-35 shrink-0 flex-col items-center gap-3 overflow-y-auto bg-sidebar p-4 md:flex">
            {root && activeEdition.cover && (
              <CoverThumb root={root} cover={activeEdition.cover ?? ""} />
            )}
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
        )}
        <main
          id="main"
          tabIndex={-1}
          className="outline-none flex min-h-96 min-w-0 shrink-0 flex-col bg-sidebar/40 lg:min-h-0 lg:flex-1 lg:shrink"
        >
          {typeset.loading && (
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
          {typeset.error && !typeset.loading && (
            <Notice role="alert" className="m-4 whitespace-pre-wrap wrap-break-word">
              {t`Showing an approximate layout, because the real one could not be typeset:`}{" "}
              {typeset.error}
            </Notice>
          )}
          {typeset.pdf ? (
            <TypstSpread
              pdf={typeset.pdf}
              box={box}
              showMargins={showMargins}
              hasCover={hasCover}
              stale={typeset.loading}
              onPages={onPages}
              {...(opening ? {} : { onOpenPage: openPage })}
            />
          ) : (
            !typeset.loading && (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
                <div className="flex flex-wrap items-start justify-center gap-6">
                  <ApproxPage
                    {...pageProps}
                    side="left"
                    title={first?.title}
                    lines={blocks.slice(0, BLOCKS_PER_PAGE)}
                  />
                  <ApproxPage
                    {...pageProps}
                    side="right"
                    lines={blocks.slice(BLOCKS_PER_PAGE, BLOCKS_PER_PAGE * 2)}
                  />
                </div>
              </div>
            )
          )}
        </main>
        <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-border bg-surface p-5 lg:w-75 lg:overflow-y-auto lg:border-s lg:border-t-0">
          <h2 className="font-book text-lg font-semibold">{t`Page setup`}</h2>
          <Select
            label={t`Trim size`}
            value={trim}
            onChange={(e) => setTrim(e.target.value as TrimSize)}
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
            <Switch label={t`Show margins`} checked={showMargins} onChange={setShowMargins} />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>{t`Crop marks`}</span>
            <Switch label={t`Crop marks`} checked={cropMarks} onChange={setCropMarks} />
          </div>
        </aside>
      </div>
    </div>
  );
}

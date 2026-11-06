import { sourceEdition } from "@cadabracraft/format";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, BookOpen, Printer } from "lucide-react";
import { TRIM_SIZES, pageBox, type TrimSize } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { errText } from "../../lib/projectError";
import { layoutOfPages } from "../../lib/page/bookPages";
import { plainBlocks } from "../../lib/export/printEstimate";
import { Button, IconButton } from "../../ui/Button";
import type { ExportFormat } from "./exportFormat";
import { useProject, type BookPage } from "../../state/project/index";
import { Notice } from "../../ui/feedback/Notice";
import { bleedInches, usePrintSetup } from "../../state/pages/printSetup";
import { usePrintPdf } from "../hooks/usePrintPdf";
import { ApproxPage } from "./ApproxSpread";
import {
  PageSetup,
  PagesRail,
  PreviewNotices,
  useOpenPreviewPage,
} from "./parts/PrintPreviewParts";
import { TypstSpread } from "./TypstSpread";

/** Width of one estimated page in px (the fallback when Typst cannot run). Height and everything inside are scaled from the trim size against it. */
const PAGE_PX = 300;
/** Blocks shown per estimated page before the text is clipped. */
const BLOCKS_PER_PAGE = 7;

interface Props {
  onBack: () => void;
  onExport: (format: ExportFormat) => void;
}

/** The estimate of the first two pages, drawn from the template, for when Typst has not (or cannot) typeset the real ones. */
function ApproxFallback({
  template,
  trim,
  bleedIn,
  cropMarks,
  showMargins,
  pages,
}: {
  template: ReturnType<typeof getTemplate>;
  trim: TrimSize;
  bleedIn: number;
  cropMarks: boolean;
  showMargins: boolean;
  pages: BookPage[] | null;
}) {
  const size = TRIM_SIZES[trim];
  const scale = PAGE_PX / size.w; // px per inch
  const first = (pages ?? []).find((p) => p.section === "chapter") ?? pages?.[0];
  const blocks = first ? plainBlocks(first.doc).filter((b) => b !== first.title) : [];
  const bodyFont = /serif/i.test(template.print.bodyFonts[0] ?? "")
    ? "var(--font-book)"
    : "var(--font-ui)";
  const pageProps = {
    template,
    margins: template.print.defaults.marginsIn,
    scale,
    widthPx: PAGE_PX,
    heightPx: PAGE_PX * (size.h / size.w),
    showMargins,
    cropMarks,
    bodyFont,
    bleedPx: bleedIn * scale,
  };
  return (
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
  );
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
  const [pdfPages, setPdfPages] = useState(0);
  const onPages = useCallback((n: number) => setPdfPages(n), []);
  const { opening, openError, openPage } = useOpenPreviewPage({
    trimSize: trim,
    bleedIn,
    cropMarks,
    onBack,
  });
  useEffect(() => {
    readPages().then(setPages, (e: unknown) => setError(errText(e)));
  }, [readPages]);
  // The book's length as the layout has it (front matter and blank pages included); only redone when the pages are read again.
  const estimate = useMemo(
    () => (pages ? layoutOfPages({ template: template.id, trimSize: trim }, pages).physical : 0),
    [pages, template.id, trim],
  );

  if (!manifest) return null;
  const size = TRIM_SIZES[trim];
  const margins = template.print.defaults.marginsIn;
  const box = pageBox(size, margins, true, { bleedIn, cropMarks });
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
        {!real && <PagesRail root={root} cover={activeEdition.cover} pages={pages} />}
        <main
          id="main"
          tabIndex={-1}
          className="outline-none flex min-h-96 min-w-0 shrink-0 flex-col bg-sidebar/40 lg:min-h-0 lg:flex-1 lg:shrink"
        >
          <PreviewNotices
            loading={typeset.loading}
            opening={opening}
            openError={openError}
            error={typeset.error}
          />
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
              <ApproxFallback
                template={template}
                trim={trim}
                bleedIn={bleedIn}
                cropMarks={cropMarks}
                showMargins={showMargins}
                pages={pages}
              />
            )
          )}
        </main>
        <PageSetup
          trim={trim}
          onTrim={setTrim}
          bleed={bleed}
          real={real}
          pdfPages={pdfPages}
          estimate={estimate}
          hasCover={hasCover}
          showMargins={showMargins}
          onShowMargins={setShowMargins}
          cropMarks={cropMarks}
        />
      </div>
    </div>
  );
}

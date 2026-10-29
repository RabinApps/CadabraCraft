import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, PenLine, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type PageBox } from "@cadabracraft/export-pdf";
import { errText } from "../../lib/projectError";
import { spreadCount, spreadLabel, spreadPages } from "../../lib/previewSpreads";
import { IconButton } from "../../ui/Button";
import { Notice } from "../../ui/Notice";

/** Screen size of one inch of paper in the preview at 100%. */
const PX_PER_IN = 50;
/** The zoom steps of the preview (a page is `PX_PER_IN` x zoom px per inch). */
export const PREVIEW_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** Opens `pdf` with pdf.js (loaded when the first preview opens) and reports its page count; null until it is ready. */
function usePdfDocument(pdf: Uint8Array, onPages: (n: number) => void) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let task: { destroy: () => Promise<void> } | null = null;
    let live = true;
    setError("");
    (async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // pdf.js may take over the buffer it is given; the store keeps `pdf` for reuse, so hand it a copy.
      const loading = pdfjs.getDocument({ data: pdf.slice() });
      task = loading;
      const opened = await loading.promise;
      if (!live) return;
      setDoc(opened);
      onPages(opened.numPages);
    })().catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [pdf, onPages]);
  return { doc, error };
}

interface PageProps {
  doc: PDFDocumentProxy;
  page: number;
  /** The text box to outline, or null. */
  outline: { top: number; bottom: number; left: number; right: number } | null;
  /** Dim the page while a newer PDF is being typeset. */
  stale: boolean;
  /** Screen px per inch of paper. */
  pxPerIn: number;
  /** Makes the page open its text in the editor; without it the page is only drawn. */
  onOpen?: (page: number) => void;
}

/** One page of the PDF on a canvas, with the margins outlined when asked. */
function PdfPage({ doc, page, outline, stale, pxPerIn, onOpen }: PageProps) {
  const { t } = useLingui();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const target = canvas.current!;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 }); // points
      const scale = pxPerIn / 72;
      const ratio = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: scale * ratio * 2 });
      target.width = viewport.width;
      target.height = viewport.height;
      setSize({ w: base.width * scale, h: base.height * scale });
      task = p.render({ canvas: target, viewport });
      await task.promise;
    })().catch(() => {
      // A render cancelled by a newer page rejects; a page that cannot be drawn stays blank.
    });
    return () => task?.cancel();
  }, [doc, page, pxPerIn]);
  return (
    <div
      className="relative shrink-0 bg-white shadow-page transition-opacity"
      style={{ width: size?.w, height: size?.h, opacity: stale ? 0.5 : 1 }}
    >
      <canvas ref={canvas} role="img" aria-label={t`Page ${page}`} className="block size-full" />
      {outline && (
        <div
          aria-hidden
          data-testid="margin-outline"
          className="pointer-events-none absolute border border-dashed border-accent/60"
          style={{
            top: outline.top * pxPerIn,
            bottom: outline.bottom * pxPerIn,
            left: outline.left * pxPerIn,
            right: outline.right * pxPerIn,
          }}
        />
      )}
      {onOpen && (
        <button
          type="button"
          aria-label={t`Open page ${page} in the editor`}
          onClick={() => onOpen(page)}
          className="group absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100">
            <span className="flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-xs font-semibold text-bg shadow-page">
              <PenLine size={12} aria-hidden />
              {t`Edit this page`}
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

interface Props {
  pdf: Uint8Array;
  /** The text margins (with bleed and slug) and the page size, from `pageBox`. */
  box: PageBox;
  showMargins: boolean;
  /** The first two pages are the cover and a blank page behind it: no margins on them. */
  hasCover: boolean;
  /** A newer PDF is being typeset. */
  stale: boolean;
  onPages: (n: number) => void;
  /** Open the editor at the text that starts this (physical) page. Without it pages are not clickable. */
  onOpenPage?: (page: number) => void;
}

/** The typeset PDF as a spread of facing pages, with buttons to turn them. Page 1 sits alone on the right, as a book opens. */
export function TypstSpread({
  pdf,
  box,
  showMargins,
  hasCover,
  stale,
  onPages,
  onOpenPage,
}: Props) {
  const { t } = useLingui();
  const { doc, error } = usePdfDocument(pdf, onPages);
  const [wanted, setIndex] = useState(0);
  const [zoomAt, setZoomAt] = useState(PREVIEW_ZOOMS.indexOf(1));
  const zoom = PREVIEW_ZOOMS[zoomAt]!;
  const total = doc?.numPages ?? 0;
  const spreads = spreadCount(total);
  // A shorter PDF (a different trim size) can have fewer spreads than the one that was open.
  const index = Math.min(wanted, Math.max(0, spreads - 1));
  const spread = spreadPages(index, total);
  const shown = spreadLabel(spread);
  const m = box.margins;
  const outlineOf = (page: number) => {
    if (!showMargins || (hasCover && page <= 2)) return null;
    const recto = page % 2 === 1;
    return {
      top: m.top,
      bottom: m.bottom,
      left: recto ? m.inside : m.outside,
      right: recto ? m.outside : m.inside,
    };
  };
  if (error)
    return <Notice role="alert" className="m-4">{t`Could not show the preview: ${error}`}</Notice>;
  const first = shown[0]!;
  const last = shown.at(-1)!;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label={t`Spread controls`}
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-border bg-surface px-3 py-1.5"
      >
        <div className="flex items-center gap-1">
          <IconButton
            icon={ChevronLeft}
            label={t`Previous pages`}
            disabled={index <= 0}
            onClick={() => setIndex(index - 1)}
          />
          <span
            data-testid="spread-label"
            className="min-w-32 text-center text-sm font-semibold sm:min-w-40"
            aria-live="polite"
          >
            {!doc
              ? "…"
              : first === last
                ? t`Page ${first} of ${total}`
                : t`Pages ${first} and ${last} of ${total}`}
          </span>
          <IconButton
            icon={ChevronRight}
            label={t`Next pages`}
            disabled={index >= spreads - 1}
            onClick={() => setIndex(index + 1)}
          />
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            icon={ZoomOut}
            label={t`Zoom out`}
            disabled={zoomAt <= 0}
            onClick={() => setZoomAt(zoomAt - 1)}
          />
          <span
            data-testid="preview-zoom"
            className="min-w-12 text-center text-sm font-semibold tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            icon={ZoomIn}
            label={t`Zoom in`}
            disabled={zoomAt >= PREVIEW_ZOOMS.length - 1}
            onClick={() => setZoomAt(zoomAt + 1)}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6">
        {doc && (
          <div dir="ltr" className="flex items-start justify-center gap-2">
            {spread.map((p, i) =>
              p === null ? (
                <span key={i} aria-hidden className="w-0 sm:w-4" />
              ) : (
                <PdfPage
                  key={p}
                  doc={doc}
                  page={p}
                  outline={outlineOf(p)}
                  stale={stale}
                  pxPerIn={PX_PER_IN * zoom}
                  {...(onOpenPage ? { onOpen: onOpenPage } : {})}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

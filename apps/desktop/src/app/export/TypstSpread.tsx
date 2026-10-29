import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type PageBox } from "@cadabracraft/export-pdf";
import { errText } from "../../lib/projectError";
import { spreadCount, spreadLabel, spreadPages } from "../../lib/previewSpreads";
import { IconButton } from "../../ui/Button";
import { Notice } from "../../ui/Notice";

/** Screen size of one inch of paper in the preview. */
const PX_PER_IN = 50;

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
}

/** One page of the PDF on a canvas, with the margins outlined when asked. */
function PdfPage({ doc, page, outline, stale }: PageProps) {
  const { t } = useLingui();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const target = canvas.current!;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 }); // points
      const scale = PX_PER_IN / 72;
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
  }, [doc, page]);
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
            top: outline.top * PX_PER_IN,
            bottom: outline.bottom * PX_PER_IN,
            left: outline.left * PX_PER_IN,
            right: outline.right * PX_PER_IN,
          }}
        />
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
}

/** The typeset PDF as a spread of facing pages, with buttons to turn them. Page 1 sits alone on the right, as a book opens. */
export function TypstSpread({ pdf, box, showMargins, hasCover, stale, onPages }: Props) {
  const { t } = useLingui();
  const { doc, error } = usePdfDocument(pdf, onPages);
  const [wanted, setIndex] = useState(0);
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
        className="flex items-center justify-center gap-1 border-b border-border bg-surface px-3 py-1.5"
      >
        <IconButton
          icon={ChevronLeft}
          label={t`Previous pages`}
          disabled={index <= 0}
          onClick={() => setIndex(index - 1)}
        />
        <span
          data-testid="spread-label"
          className="min-w-40 text-center text-sm font-semibold"
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
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6">
        {doc && (
          <div dir="ltr" className="flex items-start justify-center gap-2">
            {spread.map((p, i) =>
              p === null ? (
                <span key={i} aria-hidden className="w-0 sm:w-4" />
              ) : (
                <PdfPage key={p} doc={doc} page={p} outline={outlineOf(p)} stale={stale} />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

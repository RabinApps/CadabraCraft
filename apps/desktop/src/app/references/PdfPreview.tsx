import { useEffect, useRef, useState, type RefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { errText } from "../../lib/projectError";
import { readReferenceBytes } from "../../lib/references/references";
import { IconButton } from "../../ui/Button";
import { Notice } from "../../ui/feedback/Notice";
import { toScreen } from "../../lib/export/pdfSearch";
import { PdfSearch, type PdfHits } from "./PdfSearch";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Loads the PDF bytes and opens them with pdf.js; returns the document or the error text. */
function usePdfDocument(root: string, file: string) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      const [pdfjs, worker, data] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        readReferenceBytes(root, file),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const loading = pdfjs.getDocument({ data });
      task = loading;
      const opened = await loading.promise;
      setDoc(opened);
    })().catch((e) => setError(errText(e)));
    return () => {
      void task?.destroy();
    };
  }, [root, file]);
  return { doc, error };
}

/** A PDF drawn page by page on a canvas with pdf.js (loaded when the first PDF is opened); search hits are boxes over the canvas. */
export function PdfPreview({ root, file }: { root: string; file: string }) {
  const { t } = useLingui();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [hits, setHits] = useState<PdfHits | null>(null);
  const [transform, setTransform] = useState<number[] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const focused = useRef<HTMLSpanElement>(null);

  const { doc, error } = usePdfDocument(root, file);
  useEffect(() => {
    if (!doc) return;
    const target = canvas.current!;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      const ratio = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: ZOOMS[zoom]! * ratio });
      target.width = viewport.width;
      target.height = viewport.height;
      target.style.width = `${viewport.width / ratio}px`;
      setTransform(p.getViewport({ scale: ZOOMS[zoom]! }).transform);
      task = p.render({ canvas: target, viewport });
      await task.promise;
    })().catch(() => {
      // A render cancelled by a newer page or zoom rejects; a page that cannot be drawn stays blank.
    });
    return () => {
      task?.cancel();
    };
  }, [doc, page, zoom]);

  useEffect(() => {
    focused.current?.scrollIntoView?.({ block: "center", inline: "center" });
  }, [hits, page, transform]);

  if (error)
    return <Notice role="alert" className="m-4">{t`Could not show this PDF: ${error}`}</Notice>;
  const pages = doc?.numPages ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label={t`PDF controls`}
        // Wraps, so at phone width (and with search open) no control ends up outside the window (WCAG 2.4.11).
        className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border bg-surface px-3 py-1.5"
      >
        <IconButton
          icon={ChevronLeft}
          label={t`Previous page`}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        />
        <span className="min-w-16 text-center text-sm font-semibold" aria-live="polite">
          {pages ? t`${page} / ${pages}` : "…"}
        </span>
        <IconButton
          icon={ChevronRight}
          label={t`Next page`}
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        />
        <span className="w-4" />
        <IconButton
          icon={ZoomOut}
          label={t`Zoom out`}
          disabled={zoom <= 0}
          onClick={() => setZoom(zoom - 1)}
        />
        <span className="min-w-12 text-center text-sm font-semibold">{`${Math.round(ZOOMS[zoom]! * 100)}%`}</span>
        <IconButton
          icon={ZoomIn}
          label={t`Zoom in`}
          disabled={zoom >= ZOOMS.length - 1}
          onClick={() => setZoom(zoom + 1)}
        />
        <PdfSearch doc={doc} onGo={setPage} onHits={setHits} />
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-sidebar p-4">
        <div className="relative h-fit">
          <canvas
            ref={canvas}
            aria-label={t`PDF page ${page}`}
            className="block bg-white shadow-popover"
          />
          {transform && hits && (
            <PdfHighlights hits={hits} page={page} transform={transform} focused={focused} />
          )}
        </div>
      </div>
    </div>
  );
}

function PdfHighlights({
  hits,
  page,
  transform,
  focused,
}: {
  hits: PdfHits;
  page: number;
  transform: number[];
  focused: RefObject<HTMLSpanElement | null>;
}) {
  return hits.matches.flatMap((m, i) =>
    m.page !== page
      ? []
      : m.rects.map((r, k) => (
          <span
            key={`${i}-${k}`}
            ref={i === hits.at && k === 0 ? focused : undefined}
            aria-hidden="true"
            data-match={i === hits.at ? "current" : "other"}
            style={toScreen(r, transform)}
            className={`pointer-events-none absolute mix-blend-multiply ${
              i === hits.at
                ? "bg-accent/50 outline-2 outline-accent"
                : "bg-accent/25 outline-1 outline-dashed outline-accent"
            }`}
          />
        )),
  );
}

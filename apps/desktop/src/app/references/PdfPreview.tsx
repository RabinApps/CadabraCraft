import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { errText } from "../../lib/projectError";
import { readReferenceBytes } from "../../lib/references";
import { IconButton } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { PdfSearch } from "./PdfSearch";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** A PDF drawn page by page on a canvas with pdf.js (loaded when the first PDF is opened). */
export function PdfPreview({ root, file }: { root: string; file: string }) {
  const { t } = useLingui();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(2);
  const canvas = useRef<HTMLCanvasElement>(null);

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
      task = p.render({ canvas: target, viewport });
      await task.promise;
    })().catch(() => {
      // A render cancelled by a newer page or zoom rejects; a page that cannot be drawn stays blank.
    });
    return () => {
      task?.cancel();
    };
  }, [doc, page, zoom]);

  if (error)
    return <Notice role="alert" className="m-4">{t`Could not show this PDF: ${error}`}</Notice>;
  const pages = doc?.numPages ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="toolbar"
        aria-label={t`PDF controls`}
        className="flex items-center gap-1 border-b border-border bg-surface px-3 py-1.5"
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
        <PdfSearch doc={doc} onGo={setPage} />
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-sidebar p-4">
        <canvas
          ref={canvas}
          aria-label={t`PDF page ${page}`}
          className="h-fit bg-white shadow-popover"
        />
      </div>
    </div>
  );
}

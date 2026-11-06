import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, Maximize2, PenLine, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { type PageBox } from "@cadabracraft/export-pdf";
import { errText } from "../../lib/projectError";
import { wordAtPoint, type WordClick } from "../../lib/export/pdfWords";
import { spreadCount, spreadLabel, spreadPages } from "../../lib/export/previewSpreads";
import {
  clampZoom,
  fitZoomFor,
  pinchZoom,
  stepZoom,
  touchDistance,
  wheelZoom,
} from "../../lib/export/previewZoom";
import { IconButton } from "../../ui/Button";
import { Notice } from "../../ui/feedback/Notice";
import { usePaneWidth } from "../hooks/usePaneWidth";

/** Screen size of one inch of paper in the preview at 100%. */
const PX_PER_IN = 50;
/** Padding of the pages' scroller on each side, and the gap between two facing pages (px). */
const PAD = 24;
const PAGE_GAP = 8;

/** Opens `pdf` with pdf.js (loaded when the first preview opens) and reports its page count; null until it is ready. */
export function usePdfDocument(pdf: Uint8Array, onPages: (n: number) => void) {
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

/** The word of page `page` of `doc` at (`fx`, `fy`), fractions of the page from its top left, with all the words of the page; null on no word. */
async function wordClickAt(
  doc: PDFDocumentProxy,
  page: number,
  fx: number,
  fy: number,
): Promise<WordClick | null> {
  const p = await doc.getPage(page);
  const view = p.getViewport({ scale: 1 });
  const [x, y] = view.convertToPdfPoint(fx * view.width, fy * view.height) as [number, number];
  const content = await p.getTextContent();
  const runs = content.items.flatMap((item) =>
    "str" in item
      ? [
          {
            str: item.str,
            transform: item.transform,
            width: item.width,
            height: item.height,
            dir: item.dir,
          },
        ]
      : [],
  );
  return wordAtPoint(runs, x, y);
}

export interface PageProps {
  doc: PDFDocumentProxy;
  page: number;
  /** The text box to outline, or null. */
  outline: { top: number; bottom: number; left: number; right: number } | null;
  /** Dim the page while a newer PDF is being typeset. */
  stale: boolean;
  /** Screen px per inch of paper. */
  pxPerIn: number;
  /** Makes the page open its text in the editor, with where on the page it was clicked (fractions from its top left); without it the page is only drawn. */
  onOpen?: (page: number, fx: number, fy: number) => void;
}

/** One page of the PDF on a canvas, with the margins outlined when asked. */
export function PdfPage({ doc, page, outline, stale, pxPerIn, onOpen }: PageProps) {
  const { t } = useLingui();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // The "Edit this page" hint covers the foot of the page while hovered or focused: Escape hides it until the pointer or focus
  // leaves and comes back (WCAG 1.4.13, dismissible).
  const [hintOff, setHintOff] = useState(false);
  const [over, setOver] = useState({ pointer: false, focus: false });
  const hinted = over.pointer || over.focus;
  useEffect(() => {
    if (!hinted) return setHintOff(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHintOff(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hinted]);
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
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            // A click from the keyboard has no position: it opens the top of the page.
            const at =
              e.detail === 0 || r.width === 0
                ? null
                : { x: e.clientX - r.left, y: e.clientY - r.top };
            onOpen(page, at ? at.x / r.width : -1, at ? at.y / r.height : -1);
          }}
          data-hint-off={hintOff ? "" : undefined}
          onPointerEnter={() => setOver((o) => ({ ...o, pointer: true }))}
          onPointerLeave={() => setOver((o) => ({ ...o, pointer: false }))}
          onFocus={() => setOver((o) => ({ ...o, focus: true }))}
          onBlur={() => setOver((o) => ({ ...o, focus: false }))}
          className="group absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 group-data-hint-off:opacity-0!">
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
  /**
   * Open the editor at the text that starts this (physical) page, or at the word that was clicked when there is one. Without it
   * pages are not clickable.
   */
  onOpenPage?: (page: number, click: WordClick | null) => void;
}

/**
 * The typeset PDF as a spread of facing pages, with buttons to turn them and to zoom (steps, fit to the window, Ctrl or Cmd with the
 * wheel, a pinch of two fingers). Page 1 sits alone on the right, as a book opens.
 */
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
  const [zoomMode, setZoomMode] = useState<number | "fit">(1);
  const scroller = useRef<HTMLDivElement>(null);
  const paneW = usePaneWidth(scroller);
  const total = doc?.numPages ?? 0;
  const spreads = spreadCount(total);
  // A shorter PDF (a different trim size) can have fewer spreads than the one that was open.
  const index = Math.min(wanted, Math.max(0, spreads - 1));
  const spread = spreadPages(index, total);
  const shown = spreadLabel(spread);
  // Fit: the pages of this spread across the width of the pane, side by side.
  const across = spread.filter((p) => p !== null).length || 1;
  const fit = fitZoomFor(paneW, box.width * across, PX_PER_IN, 2 * PAD + (across - 1) * PAGE_GAP);
  const zoom = zoomMode === "fit" ? fit : zoomMode;
  // The wheel and the fingers act on the zoom as it is now, even between renders.
  const now = useRef({ zoom, fit });
  now.current = { zoom, fit };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const current = (mode: number | "fit") => (mode === "fit" ? now.current.fit : mode);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomMode((mode) => wheelZoom(current(mode), e.deltaY));
    };
    // Safari (and so the macOS webview) turns a pinch on the trackpad into gesture events, not a wheel with Ctrl.
    let gesture = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gesture = now.current.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      setZoomMode(clampZoom(gesture * (e as unknown as { scale: number }).scale));
    };
    // Two fingers on a touch screen.
    let pinch: { dist: number; zoom: number } | null = null;
    const dist = (e: TouchEvent) =>
      touchDistance(
        { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY },
        { x: e.touches[1]!.clientX, y: e.touches[1]!.clientY },
      );
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: dist(e), zoom: now.current.zoom };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      setZoomMode(pinchZoom(pinch.zoom, pinch.dist, dist(e)));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    const on = { passive: false } as const;
    el.addEventListener("wheel", onWheel, on);
    el.addEventListener("gesturestart", onGestureStart, on);
    el.addEventListener("gesturechange", onGestureChange, on);
    el.addEventListener("touchstart", onTouchStart, on);
    el.addEventListener("touchmove", onTouchMove, on);
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [doc]);
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
  const zoomIn = stepZoom(zoom, 1);
  const zoomOut = stepZoom(zoom, -1);
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
            disabled={zoomOut === null}
            onClick={() => setZoomMode(zoomOut!)}
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
            disabled={zoomIn === null}
            onClick={() => setZoomMode(zoomIn!)}
          />
          <IconButton
            icon={Maximize2}
            label={t`Fit to window`}
            active={zoomMode === "fit"}
            onClick={() => setZoomMode(zoomMode === "fit" ? 1 : "fit")}
          />
        </div>
      </div>
      <div
        ref={scroller}
        data-testid="spread-scroll"
        className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6"
        style={{ touchAction: "pan-x pan-y" }}
      >
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
                  {...(onOpenPage
                    ? {
                        onOpen: (page: number, fx: number, fy: number) => {
                          // The word under the click, when the page has text there; any failure opens the top of the page.
                          const click =
                            fx < 0 ? Promise.resolve(null) : wordClickAt(doc, page, fx, fy);
                          void click.catch(() => null).then((c) => onOpenPage(page, c));
                        },
                      }
                    : {})}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

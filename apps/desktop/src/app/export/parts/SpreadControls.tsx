import { useEffect, type RefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  clampZoom,
  pinchZoom,
  stepZoom,
  touchDistance,
  wheelZoom,
} from "../../../lib/export/previewZoom";
import { IconButton } from "../../../ui/Button";

/** The zoom of the spread: a factor, or "fit" to follow the width of the pane. */
export type ZoomMode = number | "fit";

/**
 * Zooming the pages of `scroller` with Ctrl or Cmd and the wheel, the trackpad pinch (Safari gesture events) and two fingers on a
 * touch screen. `now` always holds the zoom as it is at this moment, even between renders; `reset` is the effect's dependency.
 */
export function useZoomGestures(
  scroller: RefObject<HTMLDivElement | null>,
  now: RefObject<{ zoom: number; fit: number }>,
  setZoomMode: (update: ZoomMode | ((mode: ZoomMode) => ZoomMode)) => void,
  reset: unknown,
) {
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const current = (mode: ZoomMode) => (mode === "fit" ? now.current.fit : mode);
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
  }, [reset]);
}

/** The buttons that turn the spread and zoom it, with the page label and the zoom percentage. */
export function SpreadToolbar({
  loaded,
  first,
  last,
  total,
  index,
  spreads,
  onIndex,
  zoom,
  zoomMode,
  onZoomMode,
}: {
  /** The PDF is open; until then the label is an ellipsis. */
  loaded: boolean;
  first: number;
  last: number;
  total: number;
  index: number;
  spreads: number;
  onIndex: (index: number) => void;
  zoom: number;
  zoomMode: ZoomMode;
  onZoomMode: (mode: ZoomMode) => void;
}) {
  const { t } = useLingui();
  const zoomIn = stepZoom(zoom, 1);
  const zoomOut = stepZoom(zoom, -1);
  return (
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
          onClick={() => onIndex(index - 1)}
        />
        <span
          data-testid="spread-label"
          className="min-w-32 text-center text-sm font-semibold sm:min-w-40"
          aria-live="polite"
        >
          {!loaded
            ? "…"
            : first === last
              ? t`Page ${first} of ${total}`
              : t`Pages ${first} and ${last} of ${total}`}
        </span>
        <IconButton
          icon={ChevronRight}
          label={t`Next pages`}
          disabled={index >= spreads - 1}
          onClick={() => onIndex(index + 1)}
        />
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          icon={ZoomOut}
          label={t`Zoom out`}
          disabled={zoomOut === null}
          onClick={() => onZoomMode(zoomOut!)}
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
          onClick={() => onZoomMode(zoomIn!)}
        />
        <IconButton
          icon={Maximize2}
          label={t`Fit to window`}
          active={zoomMode === "fit"}
          onClick={() => onZoomMode(zoomMode === "fit" ? 1 : "fit")}
        />
      </div>
    </div>
  );
}

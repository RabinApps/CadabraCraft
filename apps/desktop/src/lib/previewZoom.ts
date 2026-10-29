/** The zoom steps of the print preview (a page is `PX_PER_IN` x zoom px per inch at zoom 1). */
export const PREVIEW_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
/** The limits of a zoom made with the wheel or by pinching (the steps are within them). */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The next step above (`dir` 1) or below (-1) `zoom`, or null when there is none (the zoom is at the end of the steps). */
export function stepZoom(zoom: number, dir: 1 | -1): number | null {
  const eps = 0.001;
  if (dir > 0) return PREVIEW_ZOOMS.find((s) => s > zoom + eps) ?? null;
  return [...PREVIEW_ZOOMS].reverse().find((s) => s < zoom - eps) ?? null;
}

/** Zoom after a turn of the wheel with Ctrl (or Meta) held: a trackpad pinch arrives as small deltas, a wheel notch as large ones. Up (negative delta) zooms in. */
export const wheelZoom = (zoom: number, deltaY: number): number =>
  clampZoom(zoom * Math.exp(-deltaY * 0.01));

/** Zoom after two fingers moved from `startDist` apart to `dist` apart, from the zoom they started at. */
export const pinchZoom = (start: number, startDist: number, dist: number): number =>
  startDist > 0 ? clampZoom((start * dist) / startDist) : start;

/** The zoom at which `inches` of paper across fill `paneWidthPx` minus `gutterPx`, at `pxPerIn` px per inch at zoom 1 (clamped). */
export function fitZoomFor(
  paneWidthPx: number,
  inches: number,
  pxPerIn: number,
  gutterPx: number,
): number {
  // A pane that has not been measured (width 0) or paper with no width has nothing to fit.
  if (!(paneWidthPx > 0 && inches > 0)) return 1;
  return clampZoom((paneWidthPx - gutterPx) / (inches * pxPerIn));
}

/** Distance between two touch points. */
export const touchDistance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

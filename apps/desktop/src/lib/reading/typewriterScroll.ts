/** Vertical extent of something on screen, in viewport pixels. */
export interface Span {
  top: number;
  bottom: number;
}

export interface TypewriterInput {
  /** The caret's line (from `view.coordsAtPos`). */
  caret: Span;
  /** The visible part of the scroller. */
  view: Span;
  scrollTop: number;
  /** The scroller's largest `scrollTop` (`scrollHeight - clientHeight`); omitted when unknown. */
  maxScrollTop?: number;
  /** A caret this close to the middle (px) is left alone, so a one-pixel rounding never moves the page. */
  tolerance?: number;
}

/** Pixels the caret line may be off the middle before the page is scrolled. */
export const TYPEWRITER_TOLERANCE = 2;

/**
 * The `scrollTop` that puts the caret line in the vertical middle of the visible scroller, or null when the page should stay
 * (already in the middle, or the middle cannot be reached: the first lines of a chapter, or the end without slack).
 */
export function typewriterTarget({
  caret,
  view,
  scrollTop,
  maxScrollTop = Infinity,
  tolerance = TYPEWRITER_TOLERANCE,
}: TypewriterInput): number | null {
  const delta = (caret.top + caret.bottom) / 2 - (view.top + view.bottom) / 2;
  if (Math.abs(delta) <= tolerance) return null;
  const target = Math.min(Math.max(0, scrollTop + delta), Math.max(0, maxScrollTop));
  return Math.abs(target - scrollTop) < 1 ? null : target;
}

/** Bottom padding that lets the last line reach the middle: half the visible height. */
export const typewriterSlack = (height: number): number => Math.max(0, Math.round(height / 2));

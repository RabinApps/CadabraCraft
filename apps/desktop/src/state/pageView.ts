import type { ViewMode } from "./viewMode";

/** Page view is offered in Write mode on windows at least `md` wide; never in Read mode or on a phone. */
export const pageViewAvailable = (mode: ViewMode, wide: boolean): boolean =>
  mode === "write" && wide;

/**
 * Read mode draws the book as trim-size pages on windows at least `md` wide; on a phone it keeps the plain reading layout.
 * Independent of the Page view preference, which is a Write-mode choice.
 */
export const readingPaged = (mode: ViewMode, wide: boolean): boolean => mode === "read" && wide;

/** Page view is showing when it is both wanted (the stored preference) and offered. */
export const pageViewOn = (pref: boolean, mode: ViewMode, wide: boolean): boolean =>
  pref && pageViewAvailable(mode, wide);

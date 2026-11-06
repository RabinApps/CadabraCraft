import type { ViewMode } from "./viewMode";

/** The writing surface is the paged book in Write mode on windows at least `md` wide; on a phone it is the reflowed page look. */
export const pageViewAvailable = (mode: ViewMode, wide: boolean): boolean =>
  mode === "write" && wide;

/**
 * Read mode draws the book as trim-size pages on windows at least `md` wide; on a phone it keeps the plain reading layout.
 */
export const readingPaged = (mode: ViewMode, wide: boolean): boolean => mode === "read" && wide;

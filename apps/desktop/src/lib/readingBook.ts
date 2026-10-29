/**
 * Read mode's continuous book: pure helpers for chaining page numbers across chapters, sizing the placeholders of chapters that are
 * not mounted, picking the chapter and page at the reading line, and the zoom of the pages. No React, no DOM.
 */

export type ReadingSection = "front" | "chapter" | "back";

export interface ChainEntry {
  id: string;
  section: ReadingSection;
  /** The pages the laid-out chapter really has (a leading blank page included), once its editor has measured it. */
  measured: number | null;
  /** Pages from its word count, without any blank page: used until it is measured. */
  estimate: number;
}

/**
 * The first page number to give each entry's pagination, top to bottom. A chapter starts after the previous chapter's last page
 * (its actual laid-out count, else the estimate); where the template starts chapters on a right-hand page, an even number makes
 * the chapter draw a blank left-hand page first (the pagination does that itself). Typst's printed number for the chapter's
 * opening page, when there is one, wins over the chain; when it is one page past the chain and odd, the blank page before it is
 * drawn too. Front and back matter are numbered from 1 and take no part in the chain, as in Page view.
 */
export function chainFirstPages(
  entries: readonly ChainEntry[],
  startsOn: "recto" | "any",
  typst: (id: string) => number | null = () => null,
): Map<string, number> {
  const out = new Map<string, number>();
  let next = 1;
  for (const e of entries) {
    if (e.section !== "chapter") {
      out.set(e.id, 1);
      continue;
    }
    const printed = typst(e.id) ?? next;
    const first =
      startsOn === "recto" && printed % 2 === 1 && printed - next === 1 ? printed - 1 : printed;
    const blank = startsOn === "recto" && first % 2 === 0 ? 1 : 0;
    out.set(e.id, first);
    next = first + (e.measured ?? e.estimate + blank);
  }
  return out;
}

/** Height of a chapter drawn as pages that has not been laid out yet: `pages` cards with the gap between them, at `zoom`. */
export const pagedHeight = (pages: number, pageH: number, gap: number, zoom: number): number =>
  Math.round((Math.max(1, pages) * (pageH + gap) - gap) * zoom);

/** Vertical padding around a plain chapter (top plus bottom). */
export const PLAIN_PAD_PX = 96;

/** Height of a chapter in the plain reading layout, from its words: about 6 characters a word, half an em a character. */
export function plainHeight(words: number, sizeRem: number, columnPx: number): number {
  const fontPx = sizeRem * 16;
  const perLine = Math.max(16, Math.floor(columnPx / (fontPx * 0.5)));
  const lines = Math.ceil((words * 6) / perLine);
  return Math.round(lines * fontPx * 1.75 * 1.12 + PLAIN_PAD_PX);
}

/** The index of the section the reading line is in: the last whose top is at or above it (the first when above all), the last once scrolled to the end; -1 for none. */
export function visibleIndex(tops: readonly number[], line: number, atEnd: boolean): number {
  if (tops.length === 0) return -1;
  if (atEnd) return tops.length - 1;
  let at = 0;
  tops.forEach((top, i) => {
    if (top <= line) at = i;
  });
  return at;
}

/** The number of the page the reading line is on: the last card whose top is at or above it, null for none. */
export function pageAtLine(
  cards: readonly { top: number; number: number }[],
  line: number,
): number | null {
  let hit: number | null = null;
  for (const c of cards) if (c.top <= line) hit = c.number;
  return hit;
}

/** How much each of the reading sizes (smallest to largest) scales the pages in page format; the middle one fits the width. */
export const READING_ZOOM_STEPS = [0.8, 0.9, 1, 1.12, 1.25];

/** Space left beside the pages: "wide" uses most of the pane. */
export const readingGutter = (width: "narrow" | "wide"): number => (width === "wide" ? 16 : 48);

/** Zoom of the pages in Read mode: the fit-width zoom times the step of the chosen size, within 0.3 to 2. */
export const readingZoom = (fit: number, size: number): number =>
  Math.min(2, Math.max(0.3, fit * (READING_ZOOM_STEPS[size] ?? 1)));

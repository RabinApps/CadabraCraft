/**
 * The Contents preview, pure part: the lines of the contents page as printed (from the same rows the editor shows), how they fall on
 * pages of the book's trim size when Typst cannot draw the real page, and the keys and delays that decide when a preview is made again.
 */
import type { TrimSize } from "@cadabracraft/export-pdf";
import { contentHash } from "@cadabracraft/export-audio";
import { contentsLines } from "@cadabracraft/format";
import { DEFAULT_TEMPLATE_ID, getTemplate, hasTemplate } from "@cadabracraft/templates";
import { linePitchEm, pageGeometry, PX_PER_INCH } from "../page/pageLayout";
import { toRoman, type TocRow } from "./tocView";

/** How long the book must be still before Typst is asked for the contents page (same as the page measure, `MEASURE_DELAY_MS`: a run takes seconds). */
export const TOC_TYPST_DELAY_MS = 2000;
/** The same for the HTML approximation, which is drawn in a few milliseconds: only enough to not redraw on every keystroke. */
export const TOC_APPROX_DELAY_MS = 150;
/** Gap between two page cards (px) and the padding around the stack. */
export const PREVIEW_GAP_PX = 24;
export const PREVIEW_PAD_PX = 16;
/** Largest and smallest scale a card is drawn at (1 is 96 px per inch). */
const MAX_SCALE = 1.25;
const MIN_SCALE = 0.25;

/** One entry of the printed list. */
export interface PreviewLine {
  key: string;
  title: string;
  /** 0 for a chapter, 1 to 3 for a heading. */
  level: number;
  /** Display depth under a part divider; absent means `level` is the depth. */
  indent?: number;
  /** Chapter entries are set in bold, headings in regular type. */
  bold: boolean;
  /** The number at the right edge, "≈" first when it is an estimate; null when the page has no numbers. */
  number: string | null;
  /** The page the entry is on (or a custom entry points at), when there is one: what Read mode's link scrolls to. */
  entryId?: string;
  /** The heading the entry is on, as its position among the page's headings (`OutlineItem.index`); unset for a whole page. */
  heading?: number;
}

/** The text printed for a row's number: the number, "≈" first for an estimate, a dash when none is known. */
export const numberText = (row: Pick<TocRow, "text" | "estimated">): string =>
  row.text === null ? "–" : row.estimated ? `≈${row.text}` : row.text;

/**
 * The visible entries (hidden ones dropped, custom ones kept) with the number each is printed with. `numbers` false is a plain list.
 * The entries come from `contentsLines` in `@cadabracraft/format`, the function the exports take theirs from.
 */
export function previewLines(rows: readonly TocRow[], numbers: boolean): PreviewLine[] {
  const byKey = new Map(rows.map((r) => [r.item.key, r]));
  return contentsLines(
    rows.map((r) => r.item),
    numbers ? (item) => numberText(byKey.get(item.key)!) : undefined,
  ).map(({ item, title, level, indent, bold, number }) => {
    const heading = item.kind === "heading" ? item.index : item.targetIndex;
    return {
      key: item.key,
      title,
      level,
      indent,
      bold,
      number,
      ...(item.entryId !== undefined && { entryId: item.entryId }),
      ...(heading !== undefined && { heading }),
    };
  });
}

/** Where the lines of a contents page fall: how many fit under the heading on the first page and on each further page, and the page's size in px at 96 per inch. */
export interface ContentsLayout {
  page: { w: number; h: number };
  margins: { top: number; bottom: number; inside: number; outside: number };
  fontPx: number;
  /** Height of one entry: a line of the book's type plus the space between entries. */
  entryPx: number;
  first: number;
  rest: number;
}

/** Space above the first entry on the first page, in em of the body size: the sink, the heading and the gap under it. */
const HEADING_EM = 6;
/** Space between two entries, in em (the PDF's `block(above: 0.55em, below: 0.55em)` collapses to one). */
const ENTRY_GAP_EM = 0.55;

export function contentsLayout(book: { template: string; trimSize?: TrimSize }): ContentsLayout {
  const template = getTemplate(hasTemplate(book.template) ? book.template : DEFAULT_TEMPLATE_ID);
  const g = pageGeometry(book);
  const fontPx = (template.print.fontSizePt * PX_PER_INCH) / 72;
  const entryPx = fontPx * (linePitchEm(book) + ENTRY_GAP_EM);
  const fit = (h: number) => Math.max(1, Math.floor(h / entryPx));
  return {
    page: g.page,
    margins: g.margins,
    fontPx,
    entryPx,
    first: fit(g.text.h - HEADING_EM * fontPx),
    rest: fit(g.text.h),
  };
}

/** One card of the approximate preview. */
export interface PreviewPage {
  /** 0 for the first card, which carries the heading. */
  index: number;
  lines: PreviewLine[];
  /** The roman folio at the foot of a continuation card; the first card has none (the contents page prints no folio). */
  folio: string | null;
}

/**
 * The lines split over cards: `layout.first` on the first, `layout.rest` on each next (an empty list is one card with the heading).
 * `before` is the number of front-matter pages ahead of the contents page; a continuation card's folio follows them in roman.
 */
export function approxPages(
  lines: readonly PreviewLine[],
  layout: Pick<ContentsLayout, "first" | "rest">,
  before = 0,
): PreviewPage[] {
  const pages: PreviewPage[] = [{ index: 0, lines: lines.slice(0, layout.first), folio: null }];
  for (let at = layout.first; at < lines.length; at += layout.rest) {
    const index = pages.length;
    pages.push({
      index,
      lines: lines.slice(at, at + layout.rest),
      folio: toRoman(before + index + 1),
    });
  }
  return pages;
}

/** Scale (1 is 96 px per inch) that fits a page `pageWidthPx` wide into a pane `paneWidthPx` wide, with the stack's padding either side. An unmeasured pane (0) draws at 1. */
export function cardScale(paneWidthPx: number, pageWidthPx: number): number {
  if (!(paneWidthPx > 0 && pageWidthPx > 0)) return 1;
  const s = (paneWidthPx - 2 * PREVIEW_PAD_PX) / pageWidthPx;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** The key of an approximate preview: the same lines on the same pages are not drawn again. */
export const approxKey = (parts: {
  title: string;
  lines: readonly PreviewLine[];
  layout: ContentsLayout;
  before: number;
  rtl: boolean;
}): string => contentHash(JSON.stringify(["approx", parts]));

/** How long to wait before the next preview: the first one at once, later ones after the book has been still (Typst waits longer than the estimate). */
export function previewDelay(options: { first: boolean; typst: boolean }): number {
  if (options.first) return 0;
  return options.typst ? TOC_TYPST_DELAY_MS : TOC_APPROX_DELAY_MS;
}

/** The key of a Typst contents preview: everything that changes the page, so one cached result serves the same book as long as it is unchanged. */
export const typstKey = (parts: unknown): string =>
  contentHash(JSON.stringify(["contents", parts]));

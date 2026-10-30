/**
 * Page view layout: geometry, CSS variables and pagination. Pure (no React, no DOM). The PDF from Typst is the reference; this is an estimate.
 *
 * Calibration against real Typst output (packages/export-pdf, `typst` 0.x on macOS, body font Libertinus Serif; "modern" fell back to
 * Helvetica Neue because Inter is not installed). Method: a generated book of lorem-style English (word lengths 2-10, paragraphs of 1-6
 * sentences, 4% h2, 4% scene breaks, 4% block quotes) rendered with each template and trim; real page count from `pdfinfo`, real line
 * count from `pdftotext -bbox-layout`, estimate from `paginate` fed by the `textModel.ts` line estimate and the constants below.
 *
 *   Measured line pitch (baseline to baseline, `pdftotext -bbox-layout`): novel 14.1pt = 1.28 em, nonfiction 14.9pt = 1.355 em,
 *   modern 15.4pt = 1.467 em. That is `cap height + leadingEm` (Typst measures a line from cap height to baseline): cap = 0.66 em for
 *   Libertinus Serif, 0.72 em for Helvetica Neue (`CAP_HEIGHT_EM`).
 *   Characters per line: effective average advance 0.425 em (serif ragged), x0.97 when justified and hyphenated, 0.455 em (sans);
 *   total estimated lines are within about 1% of the real ones for every template and trim (ratios 0.97 to 1.01).
 *   Vertical: a DOM block carries a trailing leading, so a page holds `text.h + pageFillSlackPx` (the trailing leading plus 0.4 line,
 *   because Typst's widow/orphan costs are soft and fill pages a little fuller than a hard 2-line rule).
 *
 *   Page-count error (estimate vs real), 24 chapters of 25-55 paragraphs, signed mean +0.6%, mean absolute 1.6%, worst 3.3%:
 *     trim        5x8     5.5x8.5   6x9     8.5x11
 *     novel      +1.0%    +1.2%    +2.9%    +1.1%
 *     nonfiction -3.2%    +2.2%    -1.3%     0.0%
 *     modern     -3.0%    -0.5%    +0.6%    +3.3%
 *     poetry     +1.4%    +1.7%    +0.5%    +1.8%
 *   Same, 60 chapters (230 to 740 pages), signed mean +0.7%, mean absolute 1.3%, worst 2.9%:
 *     novel      +1.7%    +1.0%    +1.4%     0.0%
 *     nonfiction -1.5%    +1.8%    -0.5%    +1.7%
 *     modern     -2.3%    -0.2%    +0.3%    +1.8%
 *     poetry     +0.8%    +1.7%    +0.8%    +2.9%
 *   One 700-paragraph chapter (no chapter-granularity noise, 43 to 190 pages): -1.3% to +2.2%, worst +5.1% (4 pages of 59).
 *   Known gaps: drop caps (novel) and chapter ornaments are not in the line model beyond `--page-chapter-extra`; footnotes, images,
 *   tables and lists are measured by the DOM in the editor, not estimated here.
 */
import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate as lookupTemplate,
  hasTemplate,
  resolveTrimSize,
  type PrintHeadingStyle,
} from "@cadabracraft/templates";
import type { FontKind } from "./page/textModel";

/** A book whose template is gone (for example a deleted custom one) lays out with the default template, as `resolveTrimSize` does. */
const getTemplate = (id: string) => lookupTemplate(hasTemplate(id) ? id : DEFAULT_TEMPLATE_ID);

export const PX_PER_INCH = 96;
export const PAGE_ZOOMS = [0.75, 1, 1.25] as const;

export interface PageGeometry {
  trimIn: { w: number; h: number };
  page: { w: number; h: number };
  margins: { top: number; bottom: number; inside: number; outside: number };
  text: { w: number; h: number };
}

type BookLike = { template: string; trimSize?: TrimSize };

/** Page, margins and text box in CSS px at zoom 1: trim inches x 96, the template's default margins (as the PDF exporter uses). */
export function pageGeometry(book: BookLike): PageGeometry {
  const trimIn = TRIM_SIZES[resolveTrimSize(book)];
  const m = getTemplate(book.template).print.defaults.marginsIn;
  const margins = {
    top: m.top * PX_PER_INCH,
    bottom: m.bottom * PX_PER_INCH,
    inside: m.inside * PX_PER_INCH,
    outside: m.outside * PX_PER_INCH,
  };
  const page = { w: trimIn.w * PX_PER_INCH, h: trimIn.h * PX_PER_INCH };
  return {
    trimIn: { w: trimIn.w, h: trimIn.h },
    page,
    margins,
    text: {
      w: page.w - margins.inside - margins.outside,
      h: page.h - margins.top - margins.bottom,
    },
  };
}

/** Left/right margin px for a page number (odd = recto: inside on the left; in a right-to-left book the binding is on the right, so inside is on the right). */
export function sideMargins(
  g: PageGeometry,
  pageNumber: number,
  rtl = false,
): { left: number; right: number } {
  const ltr =
    pageNumber % 2 === 1
      ? { left: g.margins.inside, right: g.margins.outside }
      : { left: g.margins.outside, right: g.margins.inside };
  return rtl ? { left: ltr.right, right: ltr.left } : ltr;
}

/** Zoom that makes the page fill `paneWidthPx` minus `gutterPx` (clamped 0.3..2). */
export function fitZoom(g: PageGeometry, paneWidthPx: number, gutterPx = 48): number {
  const z = (paneWidthPx - gutterPx) / g.page.w;
  return Math.min(2, Math.max(0.3, Number.isFinite(z) ? z : 1));
}

/** pt to CSS px. */
const PX_PER_PT = PX_PER_INCH / 72;

/**
 * Cap height of the body font as a fraction of the font size. Typst measures a line from the cap height down to the baseline
 * (its default text edges), so one line of text is `cap` tall and `par.leading` is the gap between lines: the line pitch in CSS
 * terms is (cap + leadingEm) em.
 */
export const CAP_HEIGHT_EM: Record<FontKind, number> = { serif: 0.66, sans: 0.72 };

/** Sans families the built-in templates and the font settings use; everything else is treated as serif. */
export function fontKindOf(template: string): FontKind {
  return /inter|helvetica|arial|sans|gothic|verdana|roboto|segoe/i.test(
    getTemplate(template).print.bodyFonts[0]!,
  )
    ? "sans"
    : "serif";
}

const rd = (n: number): number => Math.round(n * 1000) / 1000;
const px = (n: number): string => `${rd(n)}px`;
const emStr = (n: number): string => `${rd(n)}em`;

/** Sizes of the chapter label and ornament relative to the body, as in the PDF preamble (`chapter-start`). */
const LABEL_SIZE_EM = 0.85;
const ORNAMENT_SIZE_EM = 1.2;
/** Lines a drop cap spans (the PDF uses `dropcap(height: 3)`). */
export const DROP_CAP_LINES = 3;

/**
 * Drop cap of the first paragraph: `lines` is 0 when the template has none. Like droplet, the letter's cap height spans the lines
 * (n caps + n-1 leadings), so `sizeEm` is that over the font's cap height; `lineHeight` makes the float box exactly `lines` pitches
 * tall, which is also the height the paragraph reserves (`--page-dropcap-height`) when it is shorter than that.
 */
export function dropCapMetrics(book: BookLike): {
  lines: number;
  sizeEm: number;
  lineHeight: number;
} {
  const p = getTemplate(book.template).print;
  if (!p.chapterOpening.dropCap) return { lines: 0, sizeEm: 1, lineHeight: 1 };
  const cap = CAP_HEIGHT_EM[fontKindOf(book.template)];
  const n = DROP_CAP_LINES;
  const sizeEm = (n * cap + (n - 1) * p.leadingEm) / cap;
  return { lines: n, sizeEm, lineHeight: (n * linePitchEm(book)) / sizeEm };
}

/** Line pitch of the body text, in em of the body font size. */
export function linePitchEm(book: BookLike): number {
  const p = getTemplate(book.template).print;
  return CAP_HEIGHT_EM[fontKindOf(book.template)] + p.leadingEm;
}

/** How much of a line Typst's page fill beats a strict 2-line widow/orphan rule by (its costs are soft); measured, see the calibration block. */
const SOFT_FILL_LINES = 0.4;

/**
 * Extra height a DOM page holds beyond `text.h`. A CSS block of n lines is n x pitch tall, Typst's is n x cap + (n-1) x leading, so the
 * last line of a page carries one trailing `leading`; plus `SOFT_FILL_LINES` of a line for Typst's softer widow/orphan handling.
 * Pass `text.h + pageFillSlackPx(book)` as the `textHeight` of `paginate`.
 */
export function pageFillSlackPx(book: BookLike): number {
  const p = getTemplate(book.template).print;
  const fontPx = p.fontSizePt * PX_PER_PT;
  return p.leadingEm * fontPx + SOFT_FILL_LINES * linePitchEm(book) * fontPx;
}

function headingVars(
  level: 1 | 2 | 3,
  s: PrintHeadingStyle,
  fontPx: number,
): Record<string, string> {
  const k = `--page-h${level}`;
  return {
    [`${k}-size`]: emStr(s.sizeEm),
    [`${k}-above`]: px(level === 1 ? 0 : s.spaceAboveEm * fontPx),
    [`${k}-below`]: px(s.spaceBelowEm * fontPx),
    [`${k}-align`]: s.align,
    [`${k}-weight`]: s.bold ? "700" : "400",
    [`${k}-style`]: s.italic ? "italic" : "normal",
    [`${k}-variant`]: s.smallCaps ? "small-caps" : "normal",
  };
}

/**
 * CSS custom properties for the page container, from the template's print settings at zoom 1. Units: font size, indent and the
 * paragraph gap are in em of the body font; every other vertical space (heading above/below, chapter sink, block quote, scene break)
 * is px, because those elements change their own font size and Typst resolves their spacing against the body size.
 * `--page-line-height` is unitless (the line pitch in em), `--page-para-space` is the gap between paragraphs net of the trailing
 * leading a CSS line box already contains (negative when the template's spacing is smaller than its leading), so DOM heights and Typst heights agree.
 */
export function pageCssVars(book: BookLike, chapterNumber?: number): Record<string, string> {
  const t = getTemplate(book.template);
  const p = t.print;
  const g = pageGeometry(book);
  const fontPx = p.fontSizePt * PX_PER_PT;
  const indent = p.paragraph.style === "indent";
  const spacingEm = indent ? p.leadingEm : p.paragraph.spacingEm;
  const q = p.blockQuote;
  const o = p.chapterOpening;
  const cap = CAP_HEIGHT_EM[fontKindOf(book.template)];
  // Typst stacks, below the sink: ornament (1.2em text, one cap tall) + 0.6em gap, label (0.85em text) + 0.8em gap, then the title.
  const labelBlockEm = o.label === null ? 0 : LABEL_SIZE_EM * cap + 0.8;
  const ornamentBlockEm = o.ornament === null ? 0 : ORNAMENT_SIZE_EM * cap + 0.6;
  const extraEm = ornamentBlockEm + labelBlockEm;
  const label =
    o.label === null || chapterNumber === undefined
      ? "none"
      : JSON.stringify(o.label.replace("{n}", String(chapterNumber)).toUpperCase());
  const drop = dropCapMetrics(book);
  return {
    "--page-w": px(g.page.w),
    "--page-h": px(g.page.h),
    "--page-text-w": px(g.text.w),
    "--page-text-h": px(g.text.h),
    "--page-font-size": px(fontPx),
    "--page-line-height": String(rd(linePitchEm(book))),
    "--page-indent": emStr(indent ? p.paragraph.indentEm : 0),
    "--page-para-space": emStr(spacingEm - p.leadingEm),
    "text-align": p.justify ? "justify" : "left",
    hyphens: p.hyphenate ? "auto" : "manual",
    ...headingVars(1, p.headings[1], fontPx),
    ...headingVars(2, p.headings[2], fontPx),
    ...headingVars(3, p.headings[3], fontPx),
    "--page-chapter-sink": px(o.sinkEm * fontPx),
    "--page-chapter-extra": px(extraEm * fontPx),
    // Drawn in the space `--page-chapter-extra` reserves, as pseudo-elements of the chapter title (offsets are from the title's top).
    "--page-chapter-ornament": o.ornament === null ? "none" : JSON.stringify(o.ornament),
    "--page-chapter-ornament-size": px(ORNAMENT_SIZE_EM * fontPx),
    "--page-chapter-ornament-h": px(ORNAMENT_SIZE_EM * cap * fontPx),
    "--page-chapter-ornament-top": px(-(ornamentBlockEm + labelBlockEm) * fontPx),
    "--page-chapter-label": label,
    "--page-chapter-label-size": px(LABEL_SIZE_EM * fontPx),
    "--page-chapter-label-h": px(LABEL_SIZE_EM * cap * fontPx),
    "--page-chapter-label-top": px(-labelBlockEm * fontPx),
    "--page-dropcap-lines": String(drop.lines),
    "--page-dropcap-float": drop.lines === 0 ? "none" : "left",
    "--page-dropcap-size": emStr(drop.sizeEm),
    "--page-dropcap-lh": drop.lines === 0 ? "inherit" : String(rd(drop.lineHeight)),
    "--page-dropcap-gap": drop.lines === 0 ? "0em" : "0.12em",
    "--page-dropcap-height": px(drop.lines * linePitchEm(book) * fontPx),
    "--page-bq-indent": px(q.indentEm * fontPx),
    "--page-bq-size": emStr(q.sizeEm),
    "--page-bq-space": px(q.spaceEm * fontPx),
    "--page-bq-style": q.italic ? "italic" : "normal",
    "--page-bq-rule": q.ruleLeft ? "0.6pt solid rgb(120 120 120)" : "none",
    "--page-scene-glyph": JSON.stringify(p.sceneBreak.glyph),
    "--page-scene-space": px(p.sceneBreak.spaceEm * fontPx),
  };
}

export type BlockKind =
  | "chapterTitle"
  | "heading"
  | "paragraph"
  | "blockquote"
  | "sceneBreak"
  | "list"
  | "table"
  | "image"
  | "code"
  | "other";

export interface MeasuredBlock {
  kind: BlockKind;
  height: number;
  marginTop: number;
  marginBottom: number;
  lineHeight: number;
  lines: number;
  keepWithNext?: boolean;
}

export interface PageBreak {
  /** Index of the block the new page starts in. */
  block: number;
  /** For a block split across pages: the number of lines kept on the previous page (0 = break before the block). */
  linesBefore: number;
  /** A blank page is inserted before this page (recto rule). */
  blankBefore: boolean;
  /**
   * Typst's breaks only (`PaginateOptions.forced`), inside a block whose pieces are not lines of its own grid (a quote, list, table or code
   * block): where the page ends in the flow, `y` px below the top of the block as the DOM draws it. `flow`: the spacer is a block between
   * items rather than a piece of a line; `marginBottom` is the margin it takes back from what follows it. `linesBefore` is then only the
   * number of this break among the block's (1, 2, ...).
   */
  at?: { y: number; flow: boolean; marginBottom?: number; cuts?: CellCut[] };
}

/** A range of the document (document positions). */
export interface DocSpan {
  from: number;
  to: number;
}

/**
 * Where a page begins inside one cell of a table row. A page that begins inside a row begins in every cell of it that runs on, each at
 * its own place (Typst lays the cells of a row side by side and cuts each at the foot of the page), so such a break has one cut per
 * cell, each with a spacer of its own. `y` is where the cell's text is cut, px below the top of the table block (zoom 1, the flow
 * without spacers) and `prevY` where the cell's text on this page began when an earlier cut of the same cell did that (null: where the
 * page began). `at.y` of the break is the page's end in the flow as the rest of the block sees it.
 */
export interface CellCut {
  /** Document position of the spacer: a word of a paragraph of the cell, or the position before one. */
  pos: number;
  y: number;
  prevY: number | null;
  /** The spacer is a piece of a line (a word), not a block between two paragraphs of the cell. */
  inline: boolean;
  /** The margin the spacer takes back from the paragraph after it (a block spacer only). */
  marginBottom: number;
  cell: DocSpan;
  /** The row's own range and the content range of each of its cells, for drawing which page each piece of text is on. */
  row: DocSpan & { cells: DocSpan[] };
}

export interface PaginateOptions {
  /** Page number the content would land on next (the chapter's first page when `opensChapter`). */
  firstPage: number;
  startsOn: "recto" | "any";
  opensChapter: boolean;
  /**
   * Page breaks decided elsewhere (Typst's, in order, none of them blank): they are used as they are and nothing is simulated, so
   * block heights only matter to whoever draws the pages. A blank verso before the chapter is still added.
   */
  forced?: PageBreak[];
}

const EPS = 0.01;
const MIN_LINES = 2;
const SPLITTABLE: ReadonlySet<BlockKind> = new Set(["paragraph", "blockquote", "list", "code"]);

const canSplit = (b: MeasuredBlock): boolean =>
  SPLITTABLE.has(b.kind) && b.lines >= 2 && b.lineHeight > 0;
const keeps = (b: MeasuredBlock): boolean =>
  b.keepWithNext ?? (b.kind === "heading" || b.kind === "chapterTitle");
/** The smallest piece of a block that may sit alone at the bottom of a page. */
const firstChunk = (b: MeasuredBlock): number =>
  canSplit(b) && b.lines >= 2 * MIN_LINES ? MIN_LINES * b.lineHeight : b.height;
/** Space between two blocks, collapsed like CSS margins (the largest positive plus the most negative), none at the top of a page. */
const gapBetween = (prev: MeasuredBlock | undefined, b: MeasuredBlock, atTop: boolean): number => {
  if (atTop) return b.kind === "chapterTitle" ? b.marginTop : 0;
  const a = prev!.marginBottom; // only absent at the top of a page
  return Math.max(a, b.marginTop, 0) + Math.min(a, b.marginTop, 0);
};

/**
 * Pure pagination. `blocks` are measured at zoom 1, `textHeight` is the height a page's blocks may fill (see `trailingLeadingPx`).
 *
 * - A paragraph (or quote, list, code block) splits at line boundaries; at least 2 lines stay on each side (orphan and widow control).
 * - A heading or chapter title (`keepWithNext`, on by default for those kinds) is never the last thing on a page: it moves along with
 *   the first lines of what follows. Chains (chapter title then heading) move together.
 * - Margins collapse like CSS margins (largest positive plus most negative) and vanish at the top of a page, except a chapter title's own margin (the sink).
 * - A block taller than a page, or with no lines to split, is placed on a page of its own and overflows it.
 * - With `forced` breaks the layout is not simulated at all (see `PaginateOptions.forced`).
 * - `opensChapter` starts on a new page: with `startsOn: "recto"`, landing on an even page number puts a blank verso first. The first
 *   page is implicit, so `pageCount === breaks.length + 1`; when a blank page is needed it is that implicit first page and the first
 *   break (block 0, `blankBefore: true`) starts the first content page. No blocks means no pages.
 */
export function paginate(
  blocks: MeasuredBlock[],
  textHeight: number,
  opts: PaginateOptions,
): { breaks: PageBreak[]; pageCount: number } {
  if (blocks.length === 0) return { breaks: [], pageCount: 0 };
  const breaks: PageBreak[] = [];
  const blank = opts.opensChapter && opts.startsOn === "recto" && opts.firstPage % 2 === 0;
  if (blank) breaks.push({ block: 0, linesBefore: 0, blankBefore: true });
  if (opts.forced) {
    breaks.push(...opts.forced);
    return { breaks, pageCount: breaks.length + 1 };
  }

  const needed = (i: number): number => {
    const b = blocks[i]!;
    const next = blocks[i + 1];
    if (!keeps(b) || !next) return firstChunk(b);
    return b.height + gapBetween(b, next, false) + needed(i + 1);
  };

  let y = 0;
  let atTop = true;
  let prev: MeasuredBlock | undefined;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    // `rest` is what remains of this block (undefined = all of it); `done` the lines already placed on earlier pages.
    let done = 0;
    for (;;) {
      const whole = done === 0;
      const lines = b.lines - done;
      const height = whole ? b.height : Math.max(0, b.height - done * b.lineHeight);
      const gap = whole ? gapBetween(prev, b, atTop) : 0;
      const room = textHeight - y - gap;
      if (height === 0 || height <= room + EPS) {
        // A kept block must fit together with the first piece of what follows.
        if (whole && !atTop && keeps(b) && gap + needed(i) > textHeight - y + EPS) {
          breaks.push({ block: i, linesBefore: 0, blankBefore: false });
          y = 0;
          atTop = true;
          continue;
        }
        y += gap + height;
        atTop = false;
        break;
      }
      if (canSplit(b) && lines >= 2) {
        let n = Math.floor((room + EPS) / b.lineHeight);
        if (n >= lines) n = lines - 1;
        if (lines - n < MIN_LINES) n = lines - MIN_LINES;
        if (n >= MIN_LINES || (atTop && n >= 1)) {
          done += n;
          breaks.push({ block: i, linesBefore: done, blankBefore: false });
          y = 0;
          atTop = true;
          continue;
        }
        if (atTop && lines >= 2) {
          // Page shorter than two lines: keep one line per page rather than loop.
          done += 1;
          breaks.push({ block: i, linesBefore: done, blankBefore: false });
          continue;
        }
      }
      if (atTop) {
        // Unsplittable and taller than a page: it overflows a page of its own.
        y = textHeight;
        atTop = false;
        break;
      }
      breaks.push({ block: i, linesBefore: 0, blankBefore: false });
      y = 0;
      atTop = true;
    }
    prev = b;
  }
  return { breaks, pageCount: breaks.length + 1 };
}

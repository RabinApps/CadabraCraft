import {
  paginate,
  type BlockKind,
  type CellCut,
  type MeasuredBlock,
  type PageBreak,
} from "../../lib/pageLayout";

/**
 * The pure part of Page view pagination: no DOM, no ProseMirror view. The DOM adapter (`dom.ts`) measures the top-level blocks in
 * the unbroken flow and hands them in; this module runs `paginate` and works out the spacers ("gaps") that push the text of the next
 * page down to the next page card, and where every card sits. All numbers are CSS px at zoom 1.
 */

/** A top-level block measured in the unbroken flow (no gaps in it). */
export interface FlowBlock extends MeasuredBlock {
  /** Top edge of the block relative to the top of the text column's content box (the chapter title's sink counts as inside the page). */
  top: number;
}

/** A spacer between two pages: it ends the page before it and starts the next one at the top of the next card. */
export interface GapSpec {
  /** Index of the top-level block the next page starts in. */
  block: number;
  /** Lines of that block kept on the page before (0 = the gap sits between two blocks). */
  linesBefore: number;
  /** The page before the gap is a blank verso page (nothing on it). */
  blank: boolean;
  /** The spacer is a block between items of a list, quote or table, not a piece of a line. */
  flow: boolean;
  /** Height of the spacer: the rest of the page, its foot margin, the gap on the canvas and the next page's top margin. */
  height: number;
  /** Negative margins that cancel the neighbouring blocks' CSS margins, so a page never starts or ends with one. */
  marginTop: number;
  marginBottom: number;
  /**
   * A page that begins inside a table row: a spacer in each cell that runs onto it (see `CellCut`), each with its own height, in
   * document order. The gap's own `height` is then the page's, for the cards.
   */
  cuts?: CutSpec[];
}

/** The spacer of one cell of a row that a page begins in. */
export interface CutSpec extends Omit<CellCut, "y" | "prevY"> {
  height: number;
  marginTop: number;
}

export type PageKind = "blank" | "open" | "body";

export interface PageSpec {
  /** 0-based position in the chapter. */
  index: number;
  /** The page number (first page of the chapter + index). */
  number: number;
  top: number;
  height: number;
  /** `blank`: an empty verso page; `open`: the chapter opening page (no running head); `body`: any other page. */
  kind: PageKind;
}

export interface PageLayoutResult {
  /** The breaks are Typst's (forced), not the estimate. */
  exact: boolean;
  breaks: PageBreak[];
  gaps: GapSpec[];
  pages: PageSpec[];
  /** Height of the whole stack of cards. */
  height: number;
}

export interface LayoutInput {
  blocks: FlowBlock[];
  page: { h: number };
  margins: { top: number; bottom: number };
  /** Height a page's text may fill, with the page-fill slack (`text.h + pageFillSlackPx`). */
  textHeight: number;
  /** Space between two cards on the canvas. */
  gap: number;
  firstPage: number;
  startsOn: "recto" | "any";
  opensChapter: boolean;
  /** A blank verso comes first (the book layout's `blankBefore`). */
  blankBefore?: boolean | undefined;
  /** Typst's page breaks (see `PaginateOptions.forced`); the layout then follows them instead of estimating. */
  forced?: PageBreak[];
}

/** Space between two cards on the canvas (design: 24 px). */
export const PAGE_GAP = 24;
/** Content this much taller than the text height counts as overflowing the page. */
const OVERFLOW_PX = 1;
/** Card tops read from the DOM within this many px of the prediction snap to it, so cards stay exactly one page pitch apart. */
const SNAP_PX = 3;

export const isVerso = (pageNumber: number): boolean => pageNumber % 2 === 0;

/** The block kind of a ProseMirror top-level node. The chapter title is the heading 1 that opens the chapter. */
export function blockKind(name: string, level: number | undefined, index: number): BlockKind {
  switch (name) {
    case "heading":
      return index === 0 && level === 1 ? "chapterTitle" : "heading";
    case "paragraph":
      return "paragraph";
    case "blockquote":
      return "blockquote";
    case "bulletList":
    case "orderedList":
    case "taskList":
    case "definitionList":
      return "list";
    case "codeBlock":
      return "code";
    case "sceneBreak":
      return "sceneBreak";
    case "pageBreak":
      return "pageBreak";
    case "table":
      return "table";
    case "image":
      return "image";
    default:
      return "other";
  }
}

const EXACT_PX = 1.5;
const SPLIT_BY_LINES: ReadonlySet<BlockKind> = new Set(["blockquote", "list", "code"]);

/**
 * Lines and line pitch of a block from its measured height and its CSS line height. Paragraphs always split by lines. Quotes, lists
 * and code blocks only when they are one text block whose height is a whole number of lines (no padding or gaps between lines of
 * text), otherwise they count as one line and never split. Line pitch is `height / lines`, so the model agrees with the DOM.
 */
export function lineMetrics(
  kind: BlockKind,
  height: number,
  cssLineHeight: number,
  textBlocks: number,
): { lines: number; lineHeight: number } {
  const whole = { lines: 1, lineHeight: height };
  if (!(cssLineHeight > 0) || !(height > 0)) return whole;
  const n = Math.max(1, Math.round(height / cssLineHeight));
  const byLines = { lines: n, lineHeight: height / n };
  if (kind === "paragraph" || kind === "heading" || kind === "chapterTitle") return byLines;
  if (
    SPLIT_BY_LINES.has(kind) &&
    textBlocks === 1 &&
    Math.abs(height - n * cssLineHeight) <= EXACT_PX
  )
    return byLines;
  return whole;
}

const bottomOf = (b: FlowBlock): number => b.top + b.height;
const yLine = (b: FlowBlock, lines: number): number => b.top + lines * b.lineHeight;

/** For each block, the page it starts on (0-based) and the `linesBefore` of each split inside it, in order. */
export function blockFragments(
  breaks: PageBreak[],
  blockCount: number,
): { startPage: number; splits: number[] }[] {
  const out: { startPage: number; splits: number[] }[] = [];
  let page = 0;
  let k = 0;
  for (let i = 0; i < blockCount; i++) {
    while (k < breaks.length && breaks[k]!.block === i && breaks[k]!.linesBefore === 0) {
      page++;
      k++;
    }
    const startPage = page;
    const splits: number[] = [];
    while (k < breaks.length && breaks[k]!.block === i) {
      splits.push(breaks[k]!.linesBefore);
      page++;
      k++;
    }
    out.push({ startPage, splits });
  }
  return out;
}

/** Runs `paginate` on the measured blocks and derives the spacers and the page cards. */
export function layoutPages(input: LayoutInput): PageLayoutResult {
  const { blocks, page, margins } = input;
  const { breaks } = paginate(blocks, input.textHeight, {
    firstPage: input.firstPage,
    startsOn: input.startsOn,
    opensChapter: input.opensChapter,
    ...(input.blankBefore === undefined ? {} : { blankBefore: input.blankBefore }),
    ...(input.forced ? { forced: input.forced } : {}),
  });
  const lineY = (br: PageBreak): number =>
    br.at ? blocks[br.block]!.top + br.at.y : yLine(blocks[br.block]!, br.linesBefore);
  const startOf = (br: PageBreak): number => {
    if (br.linesBefore > 0) return lineY(br);
    return br.block === 0 ? 0 : blocks[br.block]!.top;
  };
  const endOf = (br: PageBreak): number =>
    br.linesBefore > 0 ? lineY(br) : bottomOf(blocks[br.block - 1]!);

  const gaps: GapSpec[] = [];
  const used: number[] = [];
  const pages: PageSpec[] = [];
  let top = 0;
  let start = 0;
  const blankFirst = breaks[0]?.blankBefore === true;
  const lastEnd = blocks.length ? bottomOf(blocks[blocks.length - 1]!) : 0;
  for (let k = 0; k <= breaks.length; k++) {
    const br = breaks[k];
    const blank = k === 0 && blankFirst;
    const end = br ? (blank ? start : endOf(br)) : lastEnd;
    const u = Math.max(0, end - start);
    used.push(u);
    // A page's text may fill `textHeight`, a little more than the text box (see `pageFillSlackPx`); that overrun sits in the foot
    // margin and the card stays the page size. Only a block taller than that (an image, a table) grows its card.
    const overflow = u > input.textHeight + OVERFLOW_PX;
    const height = overflow ? Math.max(page.h, margins.top + u + margins.bottom) : page.h;
    const kind: PageKind = blank
      ? "blank"
      : input.opensChapter && k === (blankFirst ? 1 : 0)
        ? "open"
        : "body";
    pages.push({ index: k, number: input.firstPage + k, top, height, kind });
    if (!br) break;
    // The spacer that ends a page whose text used `used` px of it.
    const spacer = (px: number): number =>
      px > input.textHeight + OVERFLOW_PX
        ? Math.max(page.h - px, margins.top + margins.bottom) + input.gap
        : page.h + input.gap - px;
    const gapHeight = spacer(u);
    // A page that begins inside a table row: a spacer per cell, each sized by where its own text was cut.
    const cuts = br.at?.cuts?.map((c) => ({
      pos: c.pos,
      inline: c.inline,
      height: spacer(
        blocks[br.block]!.top + c.y - (c.prevY === null ? start : blocks[br.block]!.top + c.prevY),
      ),
      marginTop: 0,
      marginBottom: c.marginBottom,
      cell: c.cell,
      row: c.row,
    }));
    const between = br.linesBefore === 0 && !blank;
    const prev = between ? blocks[br.block - 1] : undefined;
    const next = blocks[br.block];
    gaps.push({
      ...(cuts ? { cuts } : {}),
      block: br.block,
      linesBefore: br.linesBefore,
      blank,
      flow: br.at?.flow ?? false,
      height: gapHeight,
      marginTop: prev ? 0 - prev.marginBottom : 0,
      marginBottom:
        br.at?.marginBottom ?? (next && next.kind !== "chapterTitle" ? 0 - next.marginTop : 0),
    });
    top += u + gapHeight;
    start = startOf(br);
  }
  const last = pages[pages.length - 1]!;
  return { exact: input.forced !== undefined, breaks, gaps, pages, height: last.top + last.height };
}

/**
 * Takes the card tops measured in the DOM (`tops[k]` is the top of page k) where they differ from the prediction by more than a few px
 * (text that really flowed differently); smaller differences keep the predicted top, so cards stay exactly one page pitch apart.
 * A mismatch in count keeps the prediction.
 */
export function withTops(layout: PageLayoutResult, tops: number[]): PageLayoutResult {
  if (tops.length !== layout.pages.length) return layout;
  const pages = layout.pages.map((p, k) => ({
    ...p,
    top: Math.abs(tops[k]! - p.top) <= SNAP_PX ? p.top : tops[k]!,
  }));
  const last = pages[pages.length - 1]!;
  return { ...layout, pages, height: last.top + last.height };
}

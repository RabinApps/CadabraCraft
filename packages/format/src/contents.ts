/*
 * The printed contents list, the pure part shared by every place a Contents page is drawn: the editor's preview, Read mode and the
 * exporters (PDF, EPUB, Markdown, Word, Rich Text). Each gets the resolved list from `resolveToc` and takes its entries from here, so
 * the same items, in the same order, with the same level, title and weight appear everywhere. Page numbers are not decided here:
 * the caller says what number each item prints (Typst's, the estimate, or none).
 *
 *   contentsTitle(item): string                       the text printed for an item: its title, else its entry id, else "(untitled)"
 *   contentsLines(items, numberOf?): ContentsLine[]   the visible items as lines (level 0 bold); `numberOf` gives the number text or null
 *   nestContents(items): ContentsNode[]               items nested by display depth (an item goes under the nearest earlier item of a
 *                                                     lower depth); `indent` when present, else `level`
 *   CONTENTS_MAX_LEVEL                                3
 *   CONTENTS_MAX_INDENT                               4
 */

import { visibleTocItems } from "./toc";

/** The fields of an item that every exporter's own contents type has (structurally a `TocItem`). */
export interface ContentsItemLike {
  level: number;
  /** Display depth under a part divider; absent means `level` is the display depth. */
  indent?: number;
  title: string;
  entryId?: string;
  hidden?: boolean;
}

/** The deepest level a contents entry can have (headings 1 to 3, a chapter is 0). */
export const CONTENTS_MAX_LEVEL = 3;

/** The deepest display depth: a heading at level 3 inside a part (1 for the chapter, then the heading's level). */
export const CONTENTS_MAX_INDENT = 4;

/** The depth an item is drawn at: its `indent` under a part, else its `level`. */
export const contentsIndent = (item: Pick<ContentsItemLike, "level" | "indent">): number =>
  item.indent ?? item.level;

/** Last-resort text for an item with neither a title nor an entry id. */
export const UNTITLED = "(untitled)";

/** The text printed for an item: a blank title falls back to the entry id, then a placeholder, so there is never an empty link or span. */
export const contentsTitle = (item: Pick<ContentsItemLike, "title" | "entryId">): string =>
  item.title.trim() === "" ? item.entryId?.trim() || UNTITLED : item.title;

/** One printed line of the contents list. */
export interface ContentsLine<T extends ContentsItemLike = ContentsItemLike> {
  item: T;
  title: string;
  /** 0 for a chapter, 1 to 3 for a heading. */
  level: number;
  /** Display depth: 0 at the top level, 1 for a chapter in a part; a heading follows its chapter. */
  indent: number;
  /** Chapter entries are set in bold, headings in regular type. */
  bold: boolean;
  /** The number at the right edge, or null when the line prints none. */
  number: string | null;
}

/**
 * The lines to print for `items`: hidden ones dropped, the rest in order. `numberOf` (omit for a list without page numbers) returns
 * the number text printed for an item, or null for none.
 */
export function contentsLines<T extends ContentsItemLike>(
  items: readonly T[],
  numberOf?: (item: T) => string | null,
): ContentsLine<T>[] {
  return visibleTocItems(items).map((item) => ({
    item,
    title: contentsTitle(item),
    level: item.level,
    indent: contentsIndent(item),
    bold: item.level === 0,
    number: numberOf ? numberOf(item) : null,
  }));
}

export interface ContentsNode<T extends { level: number; indent?: number }> {
  item: T;
  kids: ContentsNode<T>[];
}

/** Items nested by display depth: an item goes under the nearest earlier item with a lower depth. */
export function nestContents<T extends { level: number; indent?: number }>(
  items: readonly T[],
): ContentsNode<T>[] {
  const roots: ContentsNode<T>[] = [];
  const path: ContentsNode<T>[] = [];
  for (const item of items) {
    const node: ContentsNode<T> = { item, kids: [] };
    const depth = contentsIndent(item);
    while (path.length > 0 && contentsIndent(path[path.length - 1]!.item) >= depth) path.pop();
    (path.length > 0 ? path[path.length - 1]!.kids : roots).push(node);
    path.push(node);
  }
  return roots;
}

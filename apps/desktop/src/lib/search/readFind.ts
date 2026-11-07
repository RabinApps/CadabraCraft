/**
 * Find in Read mode, pure parts. Read mode has no single editor to ask, so matches are counted on the pages' JSON (`searchBook`) and
 * a match is addressed by its number among all of the book's matches (`index`, 0-based, in reading order).
 */
import type { BookPage } from "../../state/project/types";
import type { ResultRow } from "./findHelpers";
import { searchBook, type BookSearchOptions } from "./bookSearch";

/** A page with matches, in reading order. */
export interface Hit {
  id: string;
  title: string;
  section: "front" | "chapter" | "back";
  count: number;
}

export interface ReadMatches {
  total: number;
  hits: Hit[];
}

export const noMatches: ReadMatches = { total: 0, hits: [] };

/** Counts the matches on every page of the shown book. */
export function readMatches(pages: readonly BookPage[], opts: BookSearchOptions): ReadMatches {
  const found = searchBook(
    pages.map((p) => ({ id: p.id, title: p.title, doc: p.doc })),
    opts,
  );
  const section = new Map(pages.map((p) => [p.id, p.section]));
  return {
    total: found.total,
    hits: found.pages.map((p) => ({ ...p, section: section.get(p.id) ?? "chapter" })),
  };
}

/** The page and the match number inside it for a book-wide `index`, or null when there is no such match. */
export function locate(hits: readonly Hit[], index: number): { id: string; local: number } | null {
  if (index < 0) return null;
  let rest = index;
  for (const h of hits) {
    if (rest < h.count) return { id: h.id, local: rest };
    rest -= h.count;
  }
  return null;
}

/** The book-wide index of the first match of page `id` (null when that page has none). */
export function firstIndexOf(hits: readonly Hit[], id: string): number | null {
  let before = 0;
  for (const h of hits) {
    if (h.id === id) return before;
    before += h.count;
  }
  return null;
}

/**
 * Where a new search starts: the first match on the page at the reading line, or on the next page that has one (wrapping to the
 * first match of the book). `order` is the reading order of all pages.
 */
export function startIndex(
  hits: readonly Hit[],
  order: readonly string[],
  fromId: string | null,
): number {
  if (!hits.length) return -1;
  const at = Math.max(0, order.indexOf(fromId ?? ""));
  for (let k = 0; k < order.length; k++) {
    const i = firstIndexOf(hits, order[(at + k) % order.length]!);
    if (i !== null) return i;
  }
  return 0;
}

/** The next or previous match, wrapping round the book; with no current match, Next is the first and Previous the last. */
export function stepIndex(index: number, total: number, dir: 1 | -1): number {
  if (total === 0) return -1;
  const from = index < 0 ? (dir === 1 ? -1 : 0) : index;
  return (((from + dir) % total) + total) % total;
}

/** The list of pages with matches under the find bar. */
export function readRows(hits: readonly Hit[], index: number): ResultRow[] {
  const here = locate(hits, index)?.id;
  return hits.map((h) => ({ ...h, current: h.id === here }));
}

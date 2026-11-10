import type { GlossaryItem } from "./glossary";
import type { IndexTree } from "./types";

/** What an exporter needs to write the index page: the built index and how it should look. */
export interface IndexPageSpec {
  heading: string;
  /** A, B, C above each group. */
  letterHeadings: boolean;
  /** Print 12-15 instead of 12, 13, 14, 15 (page-numbered formats only). */
  ranges: boolean;
  /** Columns on the printed page (print formats only). */
  columns: 1 | 2;
  tree: IndexTree;
}

/** What an exporter needs to write the glossary page: the entries that have a definition, in order. */
export interface GlossaryPageSpec {
  heading: string;
  items: readonly GlossaryItem[];
  /** The EPUB links the first use of each term in a chapter to its entry, and the entry back. */
  markFirstUse: boolean;
}

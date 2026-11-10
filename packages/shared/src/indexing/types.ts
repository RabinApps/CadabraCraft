/** One chapter (or page) of the book as the index and glossary builders read it. */
export interface IndexSource {
  id: string;
  doc: { content?: unknown[] };
}

/** One marked place in the text. */
export interface IndexPlace {
  /** The `indexEntry` mark's id: the anchor the exporters write at this place. */
  id: string;
  chapterId: string;
  /** Position of the chapter in the book, from 0. */
  chapterIndex: number;
  /** Position among the chapter's places, from 0. */
  order: number;
  /** The marked words. */
  snippet: string;
}

/** One `indexEntry` mark, read from the text. */
export interface IndexMarkRef {
  term: string;
  sub?: string;
  see?: string;
  seeAlso?: string;
  place: IndexPlace;
}

export interface IndexSub {
  term: string;
  places: IndexPlace[];
}

export interface IndexTerm {
  term: string;
  places: IndexPlace[];
  subs: IndexSub[];
  see: string[];
  seeAlso: string[];
}

export interface IndexGroup {
  /** The heading letter ("A"), or "#" for terms that do not start with a letter. */
  letter: string;
  terms: IndexTerm[];
}

export interface IndexProblem {
  code: "dangling-see" | "dangling-see-also";
  term: string;
  target: string;
}

export interface IndexTree {
  groups: IndexGroup[];
  problems: IndexProblem[];
}

export interface IndexOptions {
  /** BCP 47 tag the terms are sorted for (the book's language). */
  locale?: string;
  /** Terms left out of the index (compared the same way as the terms). */
  hidden?: string[];
  /** Leave out terms that appear in only one place and have no subentries or cross-references. */
  hideSingles?: boolean;
}

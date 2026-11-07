import type { ChapterDoc, EntryKind, Section } from "@cadabracraft/shared";

export interface RtfBook {
  title: string;
  author: string;
  /** BCP 47 code; defaults to "en". Right-to-left languages are refused. */
  language?: string;
}

export interface RtfChapter {
  id?: string;
  title: string;
  doc: ChapterDoc;
  /** Front matter, chapter (default) or back matter. Pages are written in reading order: front, chapters, back. */
  section?: Section;
  kind?: EntryKind;
}

/** "times" (Times New Roman), "courier" (Courier New) or any non-empty font family name. */
export type ManuscriptFont = "times" | "courier" | (string & {});

/**
 * One line of the contents page: structurally a `TocItem` from `@cadabracraft/format`, so pass
 * `visibleTocItems(resolveToc(manifest, contentsEntry, language, outlines))` (`outlines[id]` = `extractOutline` of each page).
 */
export interface RtfContentsItem {
  /** 0 for a page, 1-3 for a heading; each level indents the line by half an inch. */
  level: number;
  /** Display depth under a part divider; absent means `level`. Each depth indents the line by half an inch. */
  indent?: number;
  title: string;
  /** The page the item is on; a blank title is written as this id. */
  entryId?: string;
  /** A custom entry: `OutlineItem.index` of the heading its target points at (not used: titles only). */
  targetIndex?: number;
  /** Hidden items are skipped, so a full `resolveToc` result can be passed too. */
  hidden?: boolean;
}

export interface RtfOptions {
  /**
   * The contents list, resolved for the book's language. Written as a static list of titles (indented by level, no page numbers,
   * no links) on the page of kind "contents", after that page's own content; a contents page with no heading gets its title as
   * one. Not given: a contents page is written like any other page.
   */
  contents?: readonly RtfContentsItem[];
  /** Bytes of every image the chapters use, keyed by the project-relative path stored in the chapter (`assets/a.png`). */
  assets?: ReadonlyMap<string, Uint8Array>;
  /** "times" (Times New Roman 12, default), "courier" (Courier New 12) or any non-empty font family name (12 pt). Code blocks stay Courier New. */
  font?: ManuscriptFont;
  /** Written to the document properties. Default 2020-01-01 UTC, so output is deterministic for a given input. */
  modified?: Date;
}

export interface Shared {
  assets: ReadonlyMap<string, Uint8Array>;
  /** The next paragraph starts a new page. */
  pendingBreak: boolean;
  /** Windows language id of the book (`\\lang`), written after `\\plain` because `\\plain` resets the character language. */
  lang?: number | null;
}

export interface RunProps {
  bold?: boolean;
}

export interface Ctx {
  s: Shared;
  chapter: string;
  /** Block quote depth. */
  quote: number;
  /** List nesting depth (0 = not in a list). */
  list: number;
  inNote: boolean;
  runProps: RunProps;
}

export interface ParaOpts {
  /** Left and right indent and first-line indent in twips; the manuscript default is a 0.5 inch first-line indent. */
  left?: number;
  right?: number;
  firstLine?: number;
  jc?: "l" | "c" | "r";
  keepNext?: boolean;
  before?: number;
  after?: number;
  /** Single instead of double line spacing. */
  single?: boolean;
  /** Font size in half-points (default 24 = 12 pt). */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  /** Courier New instead of the manuscript font. */
  mono?: boolean;
  /** Outline level (0-2) so Word's navigation pane lists headings. */
  outline?: number;
  /** A paragraph inside a table cell. */
  cell?: boolean;
}

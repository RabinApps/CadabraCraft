import type { ChapterDoc, MatterKind, Section } from "@cadabracraft/shared";
import type { ManuscriptFont, Rel } from "./parts";

export interface DocxBook {
  title: string;
  author: string;
  /** BCP 47 code; defaults to "en". Right-to-left languages are refused. */
  language?: string;
}

export interface DocxChapter {
  id?: string;
  title: string;
  doc: ChapterDoc;
  /** Front matter, chapter (default) or back matter. Pages are written in reading order: front, chapters, back. */
  section?: Section;
  kind?: MatterKind;
}

/**
 * One line of the contents page: structurally a `TocItem` from `@cadabracraft/format`, so pass
 * `visibleTocItems(resolveToc(manifest, contentsEntry, language, outlines))` (`outlines[id]` = `extractOutline` of each page).
 */
export interface DocxContentsItem {
  /** 0 for a page, 1-3 for a heading; each level indents the line by half an inch. */
  level: number;
  title: string;
  /** The page the item is on; a blank title is written as this id. */
  entryId?: string;
  /** A custom entry: `OutlineItem.index` of the heading its target points at (not used: titles only). */
  targetIndex?: number;
  /** Hidden items are skipped, so a full `resolveToc` result can be passed too. */
  hidden?: boolean;
}

export interface DocxOptions {
  /**
   * The contents list, resolved for the book's language. Written as a static list of titles (indented by level, no page numbers,
   * no links) on the page of kind "contents", after that page's own content; a contents page with no heading gets its title as
   * one. Not given: a contents page is written like any other page. A Word table-of-contents field is not produced.
   */
  contents?: readonly DocxContentsItem[];
  /** Bytes of every image the chapters use, keyed by the project-relative path stored in the chapter (`assets/a.png`). */
  assets?: ReadonlyMap<string, Uint8Array>;
  /** "times" (Times New Roman 12, default), "courier" (Courier New 12) or any non-empty font family name (12 pt). Code blocks stay Courier New. */
  font?: ManuscriptFont;
  /** Written to the document properties. Default 2020-01-01 UTC, so output is deterministic for a given input. */
  modified?: Date;
}

export interface Shared {
  assets: ReadonlyMap<string, Uint8Array>;
  font: string;
  notes: string[];
  rels: Rel[];
  media: Map<string, { name: string; rel: string }>;
  mediaTypes: Map<string, string>;
  links: Map<string, string>;
  ordered: { numId: number; start: number }[];
  drawingId: number;
  /** The next paragraph starts a new page. */
  pendingBreak: boolean;
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

export interface RunProps {
  bold?: boolean;
  italic?: boolean;
}

export interface ParaOpts {
  style?: string;
  numId?: number;
  ilvl?: number;
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
  jc?: string;
  keepNext?: boolean;
  spaceBefore?: number;
  /** Section properties ending a section (inside the last paragraph of it). */
  sect?: string;
}

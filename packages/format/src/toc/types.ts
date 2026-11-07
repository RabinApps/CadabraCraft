import type { MatterKind } from "@cadabracraft/shared";
import type { EditionEntry, TocSettings } from "../manifest";
import type { OutlineItem } from "../outline";

export type TocItemKind = "page" | "heading" | "custom";

export interface TocItem {
  key: string;
  kind: TocItemKind;
  /** Entry the item is in (page, heading) or points at (custom, when its target resolves). */
  entryId?: string;
  /** 0 for a page, 1 to 3 for a heading; a custom entry takes the level of the item it follows. */
  level: number;
  /**
   * Display depth when the item sits under a part divider: a chapter in a part is 1, its headings follow one deeper (H1 is 2, H3 is
   * 4). Absent means `level` is the display depth. Layout only: keys, depth and the manifest do not change.
   */
  indent?: number;
  /** The part divider this row is grouped under, so moving a part carries it. Absent at the top level; layout only. */
  part?: string;
  title: string;
  /** True when the author's text replaces the generated one (custom entries are never "renamed"). */
  renamed: boolean;
  hidden: boolean;
  /** Headings: position among the chapter's headings, empty ones included (what `extractOutline` calls `index`). */
  index?: number;
  /** Custom entries: the key it points at (its page number comes from there). */
  target?: string;
  /** Printed page number text, set by `attachPages`. */
  page?: string;
  /** Custom entries whose `target` is a heading in the same list (hidden ones included): that heading's `index`. */
  targetIndex?: number;
  /** Custom entries only: `after` or `target` no longer resolves. */
  stale?: boolean;
}

export interface StaleOverride {
  kind: "hidden" | "title" | "order" | "custom";
  key: string;
  /** Custom entries: which reference is dangling. */
  field?: "after" | "target";
}

export type Outlines = Readonly<Record<string, readonly OutlineItem[]>>;
export interface TocPageStart {
  id: string;
  number: string;
}

export const DEFAULT_TOC: TocSettings = {
  depth: 0,
  pageNumbers: true,
  parts: true,
  hidden: [],
  titles: {},
  custom: [],
};

/** Pages the list leaves out: they are not places a reader navigates to (same set the EPUB navigation leaves out). */
export const TOC_UNLISTED_KINDS: readonly MatterKind[] = [
  "blank",
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
  "colophon",
];

export const tocSettingsOf = (entry: EditionEntry): TocSettings => entry.toc ?? DEFAULT_TOC;

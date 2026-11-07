/** Front and back matter page kinds (`kind` on manifest entries, formatVersion 2; `contents` since 7). */
export const FRONT_MATTER_KINDS = [
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
  "contents",
  "foreword",
  "preface",
  "custom",
  "blank",
] as const;
export const BACK_MATTER_KINDS = [
  "acknowledgments",
  "about-the-author",
  "also-by",
  "colophon",
  "custom",
  "blank",
] as const;

export type FrontMatterKind = (typeof FRONT_MATTER_KINDS)[number];
export type BackMatterKind = (typeof BACK_MATTER_KINDS)[number];
export type MatterKind = FrontMatterKind | BackMatterKind;

/**
 * Every kind a chapter-list entry can carry: a front or back matter kind, or `part`. A part is a divider page inside the
 * chapters list (formatVersion 11), not front or back matter.
 */
export type EntryKind = MatterKind | "part";

/** True for the `part` divider kind (a chapter-list page, never front or back matter). */
export const isPartKind = (v: unknown): v is "part" => v === "part";

/** Where a page sits in the book. Chapters have no kind. */
export type Section = "front" | "chapter" | "back";

/** Kinds a book can have at most once. */
export const SINGLE_USE_KINDS: readonly MatterKind[] = ["title-page", "copyright", "contents"];

export const isFrontMatterKind = (v: unknown): v is FrontMatterKind =>
  (FRONT_MATTER_KINDS as readonly unknown[]).includes(v);
export const isBackMatterKind = (v: unknown): v is BackMatterKind =>
  (BACK_MATTER_KINDS as readonly unknown[]).includes(v);

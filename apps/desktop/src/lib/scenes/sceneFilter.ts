import { rank } from "../fuzzy";
import type { BoardData } from "./boardData";
import type { SceneRow, SceneStatus } from "./scenes";
import type { TimelineItem } from "./timelineData";

/**
 * Which scenes the board and the timeline show. A view layer only: a filter hides rows from the screen and never deletes,
 * reorders or reindexes anything in the chapters. Within one facet the values are alternatives (OR); the facets and the
 * search text all have to hold (AND).
 */
export interface SceneFilter {
  /** POV and label values are facet keys (see `facetKey`); the empty string stands for "none". */
  pov: string[];
  status: SceneStatus[];
  label: string[];
  /** Fuzzy match on the title and the synopsis. */
  query: string;
}

export const emptyFilter: SceneFilter = { pov: [], status: [], label: [], query: "" };

export type FacetName = "pov" | "status" | "label";

/** What the colour bar follows. */
export type ColourBy = "none" | "label" | "status";

/** True when anything narrows the scenes. */
export const isFiltering = (f: SceneFilter): boolean =>
  f.pov.length > 0 || f.status.length > 0 || f.label.length > 0 || f.query.trim() !== "";

/** The key two spellings of one value share: trimmed and lower case ("Mara" and " mara " are one POV). "" is none. */
export const facetKey = (value: string): string => value.trim().toLocaleLowerCase();

export interface FacetValue {
  /** The key stored in a filter (for a status, the status itself). "" is the pseudo-value "none". */
  key: string;
  /** The first spelling met in the book, to print (empty for none; a status is printed by its own word). */
  text: string;
  count: number;
}

export type Facets = Record<FacetName, FacetValue[]>;

const STATUS_ORDER: SceneStatus[] = ["outline", "draft", "revised", "final", ""];

/** A facet's values counted case-insensitively, the names in alphabetical order and "none" last. */
function textFacet(values: readonly string[]): FacetValue[] {
  const found = new Map<string, FacetValue>();
  for (const v of values) {
    const key = facetKey(v);
    const hit = found.get(key);
    if (hit) hit.count += 1;
    else found.set(key, { key, text: v.trim(), count: 1 });
  }
  const none = found.get("");
  found.delete("");
  const named = [...found.values()].sort((a, b) => a.text.localeCompare(b.text));
  return none ? [...named, none] : named;
}

/** The distinct POVs, statuses and labels of `rows` with how many scenes carry each. */
export function facetsOf(rows: readonly SceneRow[]): Facets {
  const status = new Map<string, number>();
  for (const r of rows) status.set(r.status, (status.get(r.status) ?? 0) + 1);
  return {
    pov: textFacet(rows.map((r) => r.pov)),
    label: textFacet(rows.map((r) => r.label)),
    status: STATUS_ORDER.filter((s) => status.has(s)).map((s) => ({
      key: s,
      text: s,
      count: status.get(s)!,
    })),
  };
}

/** Every scene of the board, in book order. */
export const boardRows = (board: BoardData): SceneRow[] => board.chapters.flatMap((c) => c.rows);

/** Whether one scene passes the filter. */
export function matchScene(row: SceneRow, f: SceneFilter): boolean {
  if (f.pov.length > 0 && !f.pov.includes(facetKey(row.pov))) return false;
  if (f.status.length > 0 && !f.status.includes(row.status)) return false;
  if (f.label.length > 0 && !f.label.includes(facetKey(row.label))) return false;
  if (f.query.trim() === "") return true;
  return (
    rank(
      [row],
      f.query,
      (r) => r.title,
      (r) => r.synopsis,
    ).length > 0
  );
}

/** The board with only the scenes that pass. Chapters stay (an empty one is shown empty) and the rows keep their order. */
export function filterBoard(board: BoardData, f: SceneFilter): BoardData {
  if (!isFiltering(f)) return board;
  return {
    ...board,
    chapters: board.chapters.map((c) => ({ ...c, rows: c.rows.filter((r) => matchScene(r, f)) })),
  };
}

/**
 * The timeline items that pass. Applied after `buildTimeline` so a scene without a date still reads "follows" the scene before it
 * in the book, even when that scene is filtered out.
 */
export function filterTimeline(items: TimelineItem[], f: SceneFilter): TimelineItem[] {
  return isFiltering(f) ? items.filter((i) => matchScene(i.scene, f)) : items;
}

/** The tokens a label can take (existing design tokens only). */
export type LabelColour = "accent" | "warn" | "success";
const PALETTE: LabelColour[] = ["accent", "warn", "success"];

/** A label's colour: a stable hash of the lower-cased label picks from the palette. No label, no colour. */
export function labelColour(label: string): LabelColour | null {
  const key = facetKey(label);
  if (key === "") return null;
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

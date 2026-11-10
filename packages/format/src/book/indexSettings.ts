import { MAX_INDEX_TERM, isValidIndexTerm } from "@cadabracraft/shared";
import { FormatError } from "../errors";

/**
 * How the generated back-of-book index looks and what it leaves out (formatVersion 14). The index itself is never stored: it is
 * built at export time from the `indexEntry` marks in the pages, so these are the only index data in the manifest.
 */
export interface IndexSettings {
  /** Write an index page at the end of the book. */
  enabled: boolean;
  /** The page's title. */
  heading: string;
  /** Columns on the printed page (the EPUB is one column). */
  columns: 1 | 2;
  /** Print 12-15 instead of 12, 13, 14, 15. */
  ranges: boolean;
  /** A, B, C above each group. */
  letterHeadings: boolean;
  /** Leave out terms that appear once with no subentries or cross-references. */
  hideSingles: boolean;
  /** Terms the author left out. */
  hidden: string[];
}

export const MAX_INDEX_HEADING = 100;
export const MAX_INDEX_HIDDEN = 500;

export const defaultIndexSettings = (): IndexSettings => ({
  enabled: false,
  heading: "Index",
  columns: 2,
  ranges: true,
  letterHeadings: true,
  hideSingles: false,
  hidden: [],
});

const KEYS = [
  "enabled",
  "heading",
  "columns",
  "ranges",
  "letterHeadings",
  "hideSingles",
  "hidden",
] as const;

/** Validates `manifest.index`. Throws FormatError; unknown keys are refused so a typo is never silently lost. Absent keys take their defaults. */
export function validateIndexSettings(v: unknown, name = "index"): IndexSettings {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(`manifest: "${name}" must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(KEYS as readonly string[]).includes(k))
      throw new FormatError(`manifest: unknown key "${name}.${k}"`);
  const d = defaultIndexSettings();
  const bool = (k: "enabled" | "ranges" | "letterHeadings" | "hideSingles"): boolean => {
    if (o[k] === undefined) return d[k];
    if (typeof o[k] !== "boolean")
      throw new FormatError(`manifest: "${name}.${k}" must be true or false`);
    return o[k];
  };
  const heading = o.heading ?? d.heading;
  if (
    typeof heading !== "string" ||
    heading.trim() === "" ||
    heading.length > MAX_INDEX_HEADING ||
    /[\r\n]/.test(heading)
  )
    throw new FormatError(
      `manifest: "${name}.heading" must be one line of 1 to ${MAX_INDEX_HEADING} characters`,
    );
  const columns = o.columns ?? d.columns;
  if (columns !== 1 && columns !== 2)
    throw new FormatError(`manifest: "${name}.columns" must be 1 or 2`);
  const hidden = o.hidden ?? d.hidden;
  if (
    !Array.isArray(hidden) ||
    hidden.length > MAX_INDEX_HIDDEN ||
    !hidden.every((t) => isValidIndexTerm(t))
  )
    throw new FormatError(
      `manifest: "${name}.hidden" must be a list of at most ${MAX_INDEX_HIDDEN} terms of 1 to ${MAX_INDEX_TERM} characters`,
    );
  return {
    enabled: bool("enabled"),
    heading,
    columns,
    ranges: bool("ranges"),
    letterHeadings: bool("letterHeadings"),
    hideSingles: bool("hideSingles"),
    hidden: [...(hidden as string[])],
  };
}

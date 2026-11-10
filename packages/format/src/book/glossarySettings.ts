import {
  MAX_GLOSSARY_ALIASES,
  MAX_GLOSSARY_DEFINITION,
  MAX_GLOSSARY_TERM,
  isValidGlossaryId,
  isValidIndexTerm,
  type GlossaryEntry,
} from "@cadabracraft/shared";
import { FormatError } from "../errors";

/**
 * The book's glossary and how its page looks (formatVersion 14). The entries are stored (a definition is the author's own
 * writing); where each term is used is derived from the `glossaryTerm` marks at export time and never stored.
 */
export interface GlossarySettings {
  /** Write a glossary page at the end of the book, after the index. */
  enabled: boolean;
  heading: string;
  /** "alpha" sorts by term for the book's language; "added" keeps the entries' order. */
  order: "alpha" | "added";
  /** Also list each used term in the index. */
  inIndex: boolean;
  /** The EPUB links the first use of a term in each chapter to its entry. */
  markFirstUse: boolean;
  /** List entries with no definition in the app (exports always leave them out). */
  showUndefined: boolean;
  entries: GlossaryEntry[];
}

export const MAX_GLOSSARY_HEADING = 100;
export const MAX_GLOSSARY_ENTRIES = 2000;

export const defaultGlossarySettings = (): GlossarySettings => ({
  enabled: false,
  heading: "Glossary",
  order: "alpha",
  inIndex: false,
  markFirstUse: true,
  showUndefined: false,
  entries: [],
});

const KEYS = [
  "enabled",
  "heading",
  "order",
  "inIndex",
  "markFirstUse",
  "showUndefined",
  "entries",
] as const;
const ENTRY_KEYS = ["id", "term", "aliases", "definition"] as const;

function validateEntry(v: unknown, at: string): GlossaryEntry {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(`manifest: "${at}" must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(ENTRY_KEYS as readonly string[]).includes(k))
      throw new FormatError(`manifest: unknown key "${at}.${k}"`);
  if (!isValidGlossaryId(o.id))
    throw new FormatError(
      `manifest: "${at}.id" must be a letter, then letters, digits, _ or -, at most 64 characters`,
    );
  if (!isValidIndexTerm(o.term) || o.term.length > MAX_GLOSSARY_TERM)
    throw new FormatError(
      `manifest: "${at}.term" must be one line of 1 to ${MAX_GLOSSARY_TERM} characters`,
    );
  if (typeof o.definition !== "string" || o.definition.length > MAX_GLOSSARY_DEFINITION)
    throw new FormatError(
      `manifest: "${at}.definition" must be text of at most ${MAX_GLOSSARY_DEFINITION} characters`,
    );
  const entry: GlossaryEntry = { id: o.id as string, term: o.term, definition: o.definition };
  if (o.aliases !== undefined) {
    if (
      !Array.isArray(o.aliases) ||
      o.aliases.length > MAX_GLOSSARY_ALIASES ||
      !o.aliases.every((a) => isValidIndexTerm(a))
    )
      throw new FormatError(
        `manifest: "${at}.aliases" must be a list of at most ${MAX_GLOSSARY_ALIASES} terms of 1 to 120 characters`,
      );
    entry.aliases = [...(o.aliases as string[])];
  }
  return entry;
}

/** Validates `manifest.glossary`. Throws FormatError; unknown keys are refused so a typo is never silently lost. Absent keys take their defaults. */
export function validateGlossarySettings(v: unknown, name = "glossary"): GlossarySettings {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new FormatError(`manifest: "${name}" must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(KEYS as readonly string[]).includes(k))
      throw new FormatError(`manifest: unknown key "${name}.${k}"`);
  const d = defaultGlossarySettings();
  const bool = (k: "enabled" | "inIndex" | "markFirstUse" | "showUndefined"): boolean => {
    if (o[k] === undefined) return d[k];
    if (typeof o[k] !== "boolean")
      throw new FormatError(`manifest: "${name}.${k}" must be true or false`);
    return o[k];
  };
  const heading = o.heading ?? d.heading;
  if (
    typeof heading !== "string" ||
    heading.trim() === "" ||
    heading.length > MAX_GLOSSARY_HEADING ||
    /[\r\n]/.test(heading)
  )
    throw new FormatError(
      `manifest: "${name}.heading" must be one line of 1 to ${MAX_GLOSSARY_HEADING} characters`,
    );
  const order = o.order ?? d.order;
  if (order !== "alpha" && order !== "added")
    throw new FormatError(`manifest: "${name}.order" must be "alpha" or "added"`);
  const raw = o.entries ?? d.entries;
  if (!Array.isArray(raw) || raw.length > MAX_GLOSSARY_ENTRIES)
    throw new FormatError(
      `manifest: "${name}.entries" must be a list of at most ${MAX_GLOSSARY_ENTRIES} entries`,
    );
  const entries = raw.map((e, i) => validateEntry(e, `${name}.entries[${i}]`));
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) throw new FormatError(`manifest: duplicate glossary id "${e.id}"`);
    ids.add(e.id);
  }
  return {
    enabled: bool("enabled"),
    heading,
    order,
    inIndex: bool("inIndex"),
    markFirstUse: bool("markFirstUse"),
    showUndefined: bool("showUndefined"),
    entries,
  };
}

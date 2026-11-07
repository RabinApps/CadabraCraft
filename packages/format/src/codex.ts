/**
 * The codex: the people, places, things and lore of a book, kept beside it in `codex.json` (formatVersion 11). It is a
 * writing tool: nothing in it is printed or exported, and scenes point at its entries by id.
 */
import { isAssetPath, isValidEntryId, safeHref } from "@cadabracraft/shared";

/** What an entry can be. */
export const CODEX_KINDS = ["character", "place", "item", "lore"] as const;
export type CodexKind = (typeof CODEX_KINDS)[number];

/** Limits that keep a hand-edited file readable and a runaway import from filling the folder. */
export const MAX_CODEX_ENTRIES = 2000;
export const MAX_CODEX_NAME = 200;
export const MAX_CODEX_ALIASES = 50;
export const MAX_CODEX_ALIAS = 120;
export const MAX_CODEX_SUMMARY = 500;
export const MAX_CODEX_BODY = 20000;
export const MAX_CODEX_LINKS = 50;
export const MAX_CODEX_LINK = 500;

export interface CodexEntry {
  /** Named by a scene's cast (and its POV), the same way a page id is: a letter, then letters, digits, _ or -. */
  id: string;
  kind: CodexKind;
  name: string;
  /** Other names the entry goes by, so a search and a continuity check find it. */
  aliases: string[];
  /** One or two lines the panel shows in the list. */
  summary: string;
  /** The long body, as plain text with line breaks. */
  body: string;
  /** An image in the project's `assets/`, or null. */
  image: string | null;
  /** Web links (http, https or mailto). */
  links: string[];
}

/** The whole codex, as `codex.json` holds it. */
export interface CodexFile {
  entries: CodexEntry[];
}

// eslint-disable-next-line no-control-regex -- intentional: this is the list of forbidden control characters
const CONTROL_IN_LINE = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex -- intentional: this is the list of forbidden control characters
const CONTROL_IN_BODY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** A trimmed single-line string of at most `max` characters; null when `v` is not one. */
const line = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length <= max && !CONTROL_IN_LINE.test(s) ? s : null;
};

/** A body: at most `max` characters, line breaks and tabs allowed, empty allowed. */
const body = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length <= max && !CONTROL_IN_BODY.test(s) ? s : null;
};

const KEYS = new Set(["id", "kind", "name", "aliases", "summary", "body", "image", "links"]);

/** The entry with this id, or null. */
export const codexEntry = (file: CodexFile | null, id: string | null): CodexEntry | null =>
  (id && file?.entries.find((e) => e.id === id)) || null;

function aliasProblem(v: unknown, where: string): string | null {
  if (!Array.isArray(v)) return `${where} needs aliases (an array, empty when there are none)`;
  if (v.length > MAX_CODEX_ALIASES)
    return `${where} has ${v.length} aliases; the most one entry may hold is ${MAX_CODEX_ALIASES}`;
  const seen = new Set<string>();
  for (const [i, a] of v.entries()) {
    const s = line(a, MAX_CODEX_ALIAS);
    if (s === null)
      return `${where}, alias ${i + 1} must be one line of at most ${MAX_CODEX_ALIAS} characters`;
    const key = s.toLowerCase();
    if (seen.has(key)) return `${where}, alias ${i + 1} repeats ${JSON.stringify(s)}`;
    seen.add(key);
  }
  return null;
}

function linkProblem(v: unknown, where: string): string | null {
  if (!Array.isArray(v)) return `${where} needs links (an array, empty when there are none)`;
  if (v.length > MAX_CODEX_LINKS)
    return `${where} has ${v.length} links; the most one entry may hold is ${MAX_CODEX_LINKS}`;
  for (const [i, l] of v.entries()) {
    if (typeof l !== "string" || l.length > MAX_CODEX_LINK || safeHref(l) === null)
      return `${where}, link ${i + 1} must be an http, https or mailto address`;
  }
  return null;
}

function entryProblem(v: unknown, where: string): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return `${where} must be an object with id, kind and name`;
  const e = v as Record<string, unknown>;
  for (const k of Object.keys(e))
    if (!KEYS.has(k)) return `${where} has an unknown key ${JSON.stringify(k)}`;
  if (!isValidEntryId(String(e.id ?? "")))
    return `${where} needs an id (a letter, then letters, digits, _ or -, at most 64 characters)`;
  if (!CODEX_KINDS.includes(e.kind as CodexKind))
    return `${where} needs a kind (${CODEX_KINDS.join(", ")})`;
  const name = line(e.name, MAX_CODEX_NAME);
  if (name === null || name === "")
    return `${where} needs a name (one line of at most ${MAX_CODEX_NAME} characters)`;
  const aliases = aliasProblem(e.aliases, where);
  if (aliases) return aliases;
  if (line(e.summary, MAX_CODEX_SUMMARY) === null)
    return `${where} needs a summary (one line of at most ${MAX_CODEX_SUMMARY} characters)`;
  if (body(e.body, MAX_CODEX_BODY) === null)
    return `${where} needs a body (at most ${MAX_CODEX_BODY} characters)`;
  if (e.image !== null && (typeof e.image !== "string" || !isAssetPath(e.image)))
    return `${where} needs an image in the project's assets, or null`;
  const links = linkProblem(e.links, where);
  if (links) return links;
  return null;
}

/**
 * Why `value` is not a codex file, or null if it is one. Unknown keys, a duplicated id or alias, a bad kind, a field that
 * is too long and a link that is not http(s) or mailto are all refused, so a hand-edited file cannot smuggle anything in.
 */
export function codexProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "a codex file must be an object with an entries array";
  const f = value as Record<string, unknown>;
  for (const k of Object.keys(f))
    if (k !== "entries") return `the codex has an unknown key ${JSON.stringify(k)}`;
  if (!Array.isArray(f.entries)) return "a codex file must have an entries array";
  if (f.entries.length > MAX_CODEX_ENTRIES)
    return `${f.entries.length} entries; the most the codex may hold is ${MAX_CODEX_ENTRIES}`;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [i, e] of f.entries.entries()) {
    const problem = entryProblem(e, `entry ${i + 1}`);
    if (problem) return problem;
    const entry = e as CodexEntry;
    if (ids.has(entry.id)) return `entry ${i + 1} repeats the id ${JSON.stringify(entry.id)}`;
    ids.add(entry.id);
    // Two entries with one name would make "appears in" and the cast picker ambiguous.
    for (const n of [entry.name, ...entry.aliases]) {
      const key = n.toLowerCase();
      if (names.has(key)) return `entry ${i + 1} repeats the name ${JSON.stringify(n)}`;
      names.add(key);
    }
  }
  return null;
}

/** An empty codex, as a book without one reads it. */
export const emptyCodex = (): CodexFile => ({ entries: [] });

/** Runtime check for `codexProblem`. */
export const isCodexFile = (v: unknown): v is CodexFile => codexProblem(v) === null;

/** Throws with the problem unless `value` is a codex file. */
export function assertCodexFile(value: unknown): asserts value is CodexFile {
  const problem = codexProblem(value);
  if (problem) throw new Error(`invalid codex file: ${problem}`);
}

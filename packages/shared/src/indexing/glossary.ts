import { termKey } from "./tree";
import type { IndexSource } from "./types";

/** A glossary entry as the manifest stores it. */
export interface GlossaryEntry {
  id: string;
  term: string;
  /** Other spellings and plurals found in the text. */
  aliases?: string[];
  definition: string;
}

/** Where a glossary entry is used. */
export interface GlossaryUse {
  count: number;
  /** Chapters that use it, in book order. */
  chapterIds: string[];
  /** The chapter and mark position of the first use. */
  first: { chapterId: string; chapterIndex: number };
}

export interface GlossaryItem {
  entry: GlossaryEntry;
  /** Null when the entry is not used in the text. */
  use: GlossaryUse | null;
}

export interface GlossaryProblem {
  code: "unknown-entry" | "no-definition" | "duplicate-term";
  /** The entry id, or the term for a duplicate. */
  id: string;
}

export interface GlossaryResult {
  items: GlossaryItem[];
  problems: GlossaryProblem[];
}

export interface GlossaryOptions {
  locale?: string;
  /** "alpha" sorts by term for the book's language; "added" keeps the manifest's order. */
  order?: "alpha" | "added";
  /** Keep entries with no definition (the panel shows them; exports leave them out). */
  includeUndefined?: boolean;
}

interface RawNode {
  type?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: RawNode[];
}

/** How often and where each glossary id is used, from the `glossaryTerm` marks. */
export function collectGlossaryUses(chapters: readonly IndexSource[]): Map<string, GlossaryUse> {
  const uses = new Map<string, GlossaryUse>();
  chapters.forEach((chapter, chapterIndex) => {
    const walk = (n: RawNode) => {
      for (const m of n.marks ?? []) {
        const id = m.attrs?.id;
        if (m.type !== "glossaryTerm" || typeof id !== "string") continue;
        const u = uses.get(id) ?? {
          count: 0,
          chapterIds: [],
          first: { chapterId: chapter.id, chapterIndex },
        };
        u.count++;
        if (!u.chapterIds.includes(chapter.id)) u.chapterIds.push(chapter.id);
        uses.set(id, u);
      }
      for (const c of n.content ?? []) walk(c);
    };
    walk(chapter.doc as RawNode);
  });
  return uses;
}

/**
 * The glossary of the book: the manifest's entries with their uses. Marks that name an entry which does not exist, entries
 * with no definition and two entries with the same term are reported in `problems`. Entries with no definition are left out
 * unless `includeUndefined` is set.
 */
export function buildGlossary(
  entries: readonly GlossaryEntry[],
  uses: ReadonlyMap<string, GlossaryUse>,
  opts: GlossaryOptions = {},
): GlossaryResult {
  const problems: GlossaryProblem[] = [];
  const ids = new Set(entries.map((e) => e.id));
  for (const id of uses.keys()) if (!ids.has(id)) problems.push({ code: "unknown-entry", id });
  const seen = new Set<string>();
  let items: GlossaryItem[] = [];
  for (const entry of entries) {
    const key = termKey(entry.term);
    if (seen.has(key)) problems.push({ code: "duplicate-term", id: entry.term });
    seen.add(key);
    const defined = entry.definition.trim() !== "";
    if (!defined) problems.push({ code: "no-definition", id: entry.id });
    if (defined || opts.includeUndefined) items.push({ entry, use: uses.get(entry.id) ?? null });
  }
  if (opts.order !== "added") {
    const collator = new Intl.Collator(opts.locale, { sensitivity: "base", numeric: true });
    items = [...items].sort((a, b) => collator.compare(a.entry.term, b.entry.term));
  }
  return { items, problems };
}

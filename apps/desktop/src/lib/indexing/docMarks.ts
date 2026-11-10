import type { ChapterDoc, Mark } from "@cadabracraft/shared";
import { mergeAdjacentText } from "../search/findHelpers";

interface Json {
  type?: string;
  text?: string;
  marks?: Mark[];
  content?: Json[];
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What `mapMarks` and `markOccurrences` return: the new document and how many texts they changed or marks they added. */
export interface Edited {
  doc: ChapterDoc;
  count: number;
}

/**
 * Applies `map` to every mark of every text in the document: a mark it returns replaces the old one, `null` removes it, `undefined`
 * keeps it. Text that ends up with the same marks as its neighbour is joined again. The input is never changed.
 */
export function mapMarks(doc: ChapterDoc, map: (mark: Mark) => Mark | null | undefined): Edited {
  let count = 0;
  const walk = (n: Json): Json => {
    if (n.type === "text" && n.marks?.length) {
      let changed = false;
      const marks: Mark[] = [];
      for (const m of n.marks) {
        const r = map(m);
        if (r === undefined) marks.push(m);
        else {
          changed = true;
          if (r !== null) marks.push(r);
        }
      }
      if (!changed) return n;
      count++;
      const { marks: _old, ...rest } = n;
      return marks.length ? { ...rest, marks } : rest;
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  const next = walk(doc as Json) as ChapterDoc;
  return { doc: count ? mergeAdjacentText(next) : doc, count };
}

/** The pattern that finds `queries` as whole words, ignoring case; null when there is nothing to look for. */
export function wordPattern(queries: readonly string[]): RegExp | null {
  const parts = queries
    .map((q) => q.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((q) => escapeRegExp(q).replace(/ /g, "\\s+"));
  if (!parts.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

interface Match {
  start: number;
  end: number;
}

/** Where `pattern` matches in the text of a run of text nodes, leaving out matches that touch text `isMarked` is already on. */
function matchesIn(run: Json[], pattern: RegExp, isMarked: (m: Mark) => boolean): Match[] {
  const spans: { start: number; end: number; marked: boolean }[] = [];
  let full = "";
  for (const n of run) {
    const text = n.text ?? "";
    spans.push({
      start: full.length,
      end: full.length + text.length,
      marked: (n.marks ?? []).some(isMarked),
    });
    full += text;
  }
  const found: Match[] = [];
  for (const m of full.matchAll(pattern)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!spans.some((s) => s.marked && s.start < end && s.end > start)) found.push({ start, end });
  }
  return found;
}

/** Cuts a run of text nodes at the matches and puts `marks` (one list per match) on the pieces inside them. */
function markRun(run: Json[], found: Match[], marks: Mark[][]): Json[] {
  const out: Json[] = [];
  let at = 0;
  for (const n of run) {
    const text = n.text ?? "";
    const from = at;
    const to = at + text.length;
    at = to;
    let cursor = from;
    const piece = (a: number, b: number, extra?: Mark[]) => {
      if (b <= a) return;
      const all = [...(n.marks ?? []), ...(extra ?? [])];
      out.push({
        type: "text",
        text: text.slice(a - from, b - from),
        ...(all.length ? { marks: all } : {}),
      });
    };
    found.forEach((m, i) => {
      if (m.end <= from || m.start >= to) return;
      const a = Math.max(m.start, from);
      const b = Math.min(m.end, to);
      piece(cursor, a);
      piece(a, b, marks[i]);
      cursor = b;
    });
    piece(cursor, to);
  }
  return out;
}

/**
 * Puts the mark `make` returns on every whole-word match of `queries` (case does not matter). A match that touches text an
 * `isMarked` mark is already on is left alone, so running it twice marks nothing new. Code blocks are skipped. With `firstOnly`
 * only the first match of the document is marked. The input is never changed.
 */
export function markOccurrences(
  doc: ChapterDoc,
  queries: readonly string[],
  make: () => Mark,
  isMarked: (m: Mark) => boolean,
  firstOnly = false,
): Edited {
  const pattern = wordPattern(queries);
  if (!pattern) return { doc, count: 0 };
  let count = 0;
  const walk = (n: Json): Json => {
    if (!n.content || n.type === "codeBlock") return n;
    const out: Json[] = [];
    let run: Json[] = [];
    const flush = () => {
      if (!run.length) return;
      let found = matchesIn(run, pattern, isMarked);
      if (firstOnly && count > 0) found = [];
      else if (firstOnly) found = found.slice(0, 1);
      if (found.length) {
        count += found.length;
        out.push(
          ...markRun(
            run,
            found,
            found.map(() => [make()]),
          ),
        );
      } else out.push(...run);
      run = [];
    };
    for (const c of n.content) {
      if (c.type === "text") run.push(c);
      else {
        flush();
        out.push(walk(c));
      }
    }
    flush();
    return { ...n, content: out };
  };
  const next = walk(doc as Json) as ChapterDoc;
  return { doc: count ? mergeAdjacentText(next) : doc, count };
}

/** How many whole-word matches `markOccurrences` would mark in these documents. */
export function countOccurrences(
  docs: readonly ChapterDoc[],
  queries: readonly string[],
  isMarked: (m: Mark) => boolean,
): number {
  let total = 0;
  for (const doc of docs)
    total += markOccurrences(doc, queries, () => ({ type: "bold" }), isMarked).count;
  return total;
}

/**
 * Fuzzy matching for the command palette and the outline navigator: the query's letters have to appear in the text in the same
 * order, not necessarily next to each other ("exppdf" finds "Export Print PDF"). Pure functions; positions index the text by
 * code point (`Array.from(text)`), so they stay right for letters outside the Basic Multilingual Plane and for any script.
 */

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number;
  /** Indexes (by code point) of the text characters that matched, ascending. */
  positions: number[];
}

const lower = (c: string): string => c.toLocaleLowerCase();
const isWordChar = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);

/** Points for a letter that matched at `at`: a letter that starts a word scores higher. */
const letterScore = (text: readonly string[], at: number): number =>
  at === 0 || !isWordChar(text[at - 1]!) ? 4 : 1;

/** Moving from one matched letter to the next: next to each other earns points, a gap costs a little (up to a limit). */
const stepScore = (gap: number): number => (gap === 0 ? 5 : -Math.min(gap, 5) * 0.2);

/** Matching later in the text costs a little, and a longer text ranks below a shorter one with the same match. */
const START_COST = 0.1;
const LENGTH_COST = 0.01;

/**
 * Matches `query` against `text`, ignoring case and any spaces in the query. Returns null when the letters do not all occur in
 * order. An empty query matches everything with score 0 and nothing highlighted. Of the ways to match, the best-scoring one wins.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = Array.from(query)
    .filter((c) => !/\s/u.test(c))
    .map(lower);
  if (q.length === 0) return { score: 0, positions: [] };
  const original = Array.from(text);
  const t = original.map(lower);
  // best[j][i]: the highest score of matching the first j+1 query letters with the last one at text index i.
  const best = q.map(() => t.map(() => -Infinity));
  const from = q.map(() => t.map(() => -1));
  q.forEach((c, j) => {
    t.forEach((tc, i) => {
      if (tc !== c) return;
      const own = letterScore(original, i);
      if (j === 0) {
        best[0]![i] = own - i * START_COST;
        return;
      }
      for (let k = 0; k < i; k++) {
        // A letter that cannot be reached scores -Infinity, which never wins.
        const score = own + best[j - 1]![k]! + stepScore(i - k - 1);
        if (score > best[j]![i]!) {
          best[j]![i] = score;
          from[j]![i] = k;
        }
      }
    });
  });
  const last = best[q.length - 1]!;
  const end = last.reduce((top, s, i) => (s > last[top]! ? i : top), 0);
  // No text at all, or some letter of the query nowhere to be found.
  if (!(last[end]! > -Infinity)) return null;
  const positions = [end];
  for (let j = q.length - 1; j > 0; j--) positions.unshift(from[j]![positions[0]!]!);
  return { score: last[end]! - t.length * LENGTH_COST, positions };
}

export interface Ranked<T> {
  item: T;
  /** Indexes (by code point) in the item's label to highlight. */
  positions: number[];
}

/** A match in the label itself beats one that needs the secondary text (the menu name), by this much. */
const LABEL_BONUS = 10;

/**
 * The items that match, best first (ties keep their input order). Each is matched on its label; failing that, on the secondary
 * text followed by the label, so "file export" finds "EPUB…" under File > Export. Highlights only ever cover the label.
 * An empty query keeps every item in its input order.
 */
export function rank<T>(
  items: readonly T[],
  query: string,
  labelOf: (item: T) => string,
  secondaryOf: (item: T) => string = () => "",
): Ranked<T>[] {
  const scored: { ranked: Ranked<T>; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const label = labelOf(item);
    const own = fuzzyMatch(query, label);
    if (own) {
      scored.push({
        ranked: { item, positions: own.positions },
        score: own.score + LABEL_BONUS,
        order,
      });
      return;
    }
    const secondary = secondaryOf(item);
    const prefix = Array.from(secondary).length + 1;
    const wide = fuzzyMatch(query, `${secondary} ${label}`);
    if (wide)
      scored.push({
        ranked: {
          item,
          positions: wide.positions.filter((p) => p >= prefix).map((p) => p - prefix),
        },
        score: wide.score,
        order,
      });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.ranked);
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** Splits `text` into runs that are matched or not, for highlighting. Joined, the runs are the text again. */
export function highlightSegments(text: string, positions: readonly number[]): Segment[] {
  const hits = new Set(positions);
  const segments: Segment[] = [];
  Array.from(text).forEach((c, i) => {
    const hit = hits.has(i);
    const last = segments.at(-1);
    if (last && last.hit === hit) last.text += c;
    else segments.push({ text: c, hit });
  });
  return segments;
}

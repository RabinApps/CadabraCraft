import type {
  IndexGroup,
  IndexMarkRef,
  IndexOptions,
  IndexPlace,
  IndexProblem,
  IndexSub,
  IndexTerm,
  IndexTree,
} from "./types";

/** How two spellings of a term are compared: no case, no accents, one space between words. */
export const termKey = (term: string): string =>
  term.trim().replace(/\s+/g, " ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const clean = (term: string): string => term.trim().replace(/\s+/g, " ");

const byPlace = (a: IndexPlace, b: IndexPlace) =>
  a.chapterIndex - b.chapterIndex || a.order - b.order;

/** The heading letter of a term: its first letter in capitals, or "#" when it starts with something else. */
export function indexLetter(term: string): string {
  const first = termKey(term).charAt(0);
  return /\p{L}/u.test(first) ? first.toUpperCase() : "#";
}

/**
 * The index of the book: marks grouped by term (spelled as first written), subentries nested, places in reading order,
 * terms sorted for the book's language and grouped by letter. A cross-reference to a term that has no entry is reported in
 * `problems` and stays in the tree so the author sees it.
 */
export function buildIndex(refs: readonly IndexMarkRef[], opts: IndexOptions = {}): IndexTree {
  const hidden = new Set((opts.hidden ?? []).map(termKey));
  const terms = new Map<string, IndexTerm>();
  for (const r of refs) {
    const key = termKey(r.term);
    if (hidden.has(key)) continue;
    let t = terms.get(key);
    if (!t)
      terms.set(key, (t = { term: clean(r.term), places: [], subs: [], see: [], seeAlso: [] }));
    if (r.sub) {
      let s: IndexSub | undefined = t.subs.find((x) => termKey(x.term) === termKey(r.sub!));
      if (!s) t.subs.push((s = { term: clean(r.sub), places: [] }));
      s.places.push(r.place);
    } else if (!r.see && !r.seeAlso) {
      t.places.push(r.place);
    }
    for (const [list, target] of [
      [t.see, r.see],
      [t.seeAlso, r.seeAlso],
    ] as const) {
      if (target && !list.some((x) => termKey(x) === termKey(target))) list.push(clean(target));
    }
  }
  const collator = new Intl.Collator(opts.locale, { sensitivity: "base", numeric: true });
  const all = [...terms.values()];
  const problems: IndexProblem[] = [];
  for (const t of all) {
    t.places.sort(byPlace);
    t.subs.forEach((s) => s.places.sort(byPlace));
    t.subs.sort((a, b) => collator.compare(a.term, b.term));
    for (const [list, code] of [
      [t.see, "dangling-see"],
      [t.seeAlso, "dangling-see-also"],
    ] as const) {
      list.sort((a, b) => collator.compare(a, b));
      for (const target of list)
        if (!terms.has(termKey(target))) problems.push({ code, term: t.term, target });
    }
  }
  const kept = all.filter(
    (t) =>
      !opts.hideSingles ||
      t.places.length !== 1 ||
      t.subs.length > 0 ||
      t.see.length > 0 ||
      t.seeAlso.length > 0,
  );
  kept.sort((a, b) => collator.compare(a.term, b.term));
  const groups: IndexGroup[] = [];
  for (const t of kept) {
    const letter = indexLetter(t.term);
    const g = groups.find((x) => x.letter === letter);
    if (g) g.terms.push(t);
    else groups.push({ letter, terms: [t] });
  }
  // Terms are already sorted, so the letters are in order; symbols and numbers always come first.
  return {
    groups: [...groups.filter((g) => g.letter === "#"), ...groups.filter((g) => g.letter !== "#")],
    problems,
  };
}

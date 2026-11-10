import {
  termKey,
  type GlossaryItem,
  type IndexGroup,
  type IndexTerm,
  type IndexTree,
} from "@cadabracraft/shared";

export type IndexFilter = "all" | "attention" | "xrefs";
export type GlossaryFilter = "all" | "undefined" | "unused";

/** How many places a term is marked at, subentries included. */
export const placeCount = (t: IndexTerm): number =>
  t.places.length + t.subs.reduce((n, s) => n + s.places.length, 0);

/** The cross-references of a term that name a term the index does not have, as "target" texts. */
export function danglingTargets(tree: IndexTree, term: string): string[] {
  return tree.problems.filter((p) => termKey(p.term) === termKey(term)).map((p) => p.target);
}

const matches = (t: IndexTerm, query: string): boolean => {
  const q = termKey(query);
  return (
    q === "" ||
    [t.term, ...t.subs.map((s) => s.term), ...t.see, ...t.seeAlso].some((x) =>
      termKey(x).includes(q),
    )
  );
};

/** The letter groups the panel shows for a search and a filter; groups left with no term are dropped. */
export function filterIndex(tree: IndexTree, query: string, filter: IndexFilter): IndexGroup[] {
  const keep = (t: IndexTerm): boolean => {
    if (!matches(t, query)) return false;
    if (filter === "attention") return danglingTargets(tree, t.term).length > 0;
    return filter === "xrefs" ? t.see.length + t.seeAlso.length > 0 : true;
  };
  return tree.groups
    .map((g) => ({ ...g, terms: g.terms.filter(keep) }))
    .filter((g) => g.terms.length > 0);
}

/** How many terms the index has. */
export const termCount = (tree: IndexTree): number =>
  tree.groups.reduce((n, g) => n + g.terms.length, 0);

/** The glossary entries the panel shows for a search and a filter. */
export function filterGlossary(
  items: readonly GlossaryItem[],
  query: string,
  filter: GlossaryFilter,
): GlossaryItem[] {
  const q = termKey(query);
  return items.filter(({ entry, use }) => {
    if (filter === "undefined" && entry.definition.trim() !== "") return false;
    if (filter === "unused" && use) return false;
    return (
      q === "" ||
      [entry.term, ...(entry.aliases ?? []), entry.definition].some((x) => termKey(x).includes(q))
    );
  });
}

import { useMemo } from "react";
import { termKey } from "@cadabracraft/shared";
import { useBookIndex } from "../../app/indexing/useIndexData";
import { countOccurrences } from "../../lib/indexing/docMarks";

/**
 * What the index entry dialog looks up in the book: the terms already in the index (suggestions for the term and the target) and how
 * many places have the selected words and are not marked with this term and sub-entry yet.
 */
export function useIndexLookups(words: string, term: string, sub: string) {
  const { pages, data } = useBookIndex(true);
  const found = useMemo(
    () =>
      pages
        ? countOccurrences(
            pages.map((p) => p.doc),
            [words],
            (m) =>
              m.type === "indexEntry" &&
              termKey(m.attrs?.term ?? "") === termKey(term) &&
              termKey(m.attrs?.sub ?? "") === termKey(sub),
          )
        : 0,
    [pages, words, term, sub],
  );
  const known = useMemo(
    () => data?.tree.groups.flatMap((g) => g.terms.map((x) => x.term)) ?? [],
    [data],
  );
  return { found, known };
}

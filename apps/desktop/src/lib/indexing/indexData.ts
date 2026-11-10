import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type GlossaryResult,
  type GlossaryUse,
  type IndexMarkRef,
  type IndexSource,
  type IndexTree,
} from "@cadabracraft/shared";
import type { GlossarySettings } from "@cadabracraft/format";

/** What the panels show: the index of the marks in the book, and the glossary with where each entry is used. */
export interface IndexData {
  refs: IndexMarkRef[];
  tree: IndexTree;
  uses: Map<string, GlossaryUse>;
  glossary: GlossaryResult;
}

/**
 * Everything derived from the book's pages. The index has no hidden terms and no single-use filter here: the panel lists
 * every term and the settings only change what the exports write. The glossary lists entries with no definition too.
 */
export function deriveIndexData(
  pages: readonly IndexSource[],
  glossary: GlossarySettings | undefined,
  locale: string,
): IndexData {
  const refs = collectIndexMarks(pages);
  const uses = collectGlossaryUses(pages);
  return {
    refs,
    tree: buildIndex(refs, { locale }),
    uses,
    glossary: buildGlossary(glossary?.entries ?? [], uses, {
      locale,
      order: glossary?.order ?? "alpha",
      includeUndefined: true,
    }),
  };
}

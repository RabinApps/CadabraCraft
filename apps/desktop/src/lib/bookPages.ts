import type { TrimSize } from "@cadabracraft/export-pdf";
import type { Manifest } from "@cadabracraft/format";
import { resolveTrimSize } from "@cadabracraft/templates";
import { bookPageCount } from "./pageNumbering";

/**
 * The book's print page size and page count, counted like Page view does (see `firstPageNumber`): `words` is each chapter's word
 * count in order, `measured` the pages Page view measured for some of them (chapter index to count). `exact` is false while any
 * chapter is only estimated from its words: the PDF is the reference.
 */
export function bookPages(
  manifest: Pick<Manifest, "template" | "trimSize">,
  words: number[],
  measured?: ReadonlyMap<number, number>,
): { trimSize: TrimSize; pages: number; exact: boolean } {
  return { trimSize: resolveTrimSize(manifest), ...bookPageCount(manifest, words, measured) };
}

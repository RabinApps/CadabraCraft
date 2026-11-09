import { analyzeBlocks, blockTexts, type AnalysisReport } from "@cadabracraft/shared";
import type { BookPage } from "../../state/project/types";

/** The two tabs of the report: every chapter of the book, or the chapter that is open. */
export type Scope = "book" | "chapter";

/**
 * The pages a scope reads. The book is its chapters, as the word count counts them (no front or back matter, no parts);
 * the chapter is the open page, whatever it is.
 */
export function pagesInScope(
  pages: readonly BookPage[],
  scope: Scope,
  openId: string | null,
): BookPage[] {
  if (scope === "chapter") return pages.filter((p) => p.id === openId);
  return pages.filter((p) => p.section === "chapter" && p.kind !== "part");
}

/** The analysis report of one scope, built from the paragraphs of its pages in reading order. */
export function reportFor(
  pages: readonly BookPage[],
  scope: Scope,
  openId: string | null,
): AnalysisReport {
  const blocks = pagesInScope(pages, scope, openId).flatMap((p) => blockTexts(p.doc));
  return analyzeBlocks(blocks);
}

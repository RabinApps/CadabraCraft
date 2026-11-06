import type { BookPages } from "@cadabracraft/shared";
import type { TrimSize } from "@cadabracraft/export-pdf";
import { countWords } from "@cadabracraft/shared";
import { resolveTrimSize } from "@cadabracraft/templates";
import { bookLayout, type EntryWords, type PageSources } from "./pageNumbering";
import type { BookPage } from "../../state/project/types";

type BookLike = { template: string; trimSize?: TrimSize };

/** The words of every page in reading order, as the layout takes them (front and back matter included, an empty page at 0). */
export const entryWordsOf = (pages: readonly BookPage[]): EntryWords[] =>
  pages.map((p) => ({
    id: p.id,
    section: p.section,
    kind: p.kind,
    verticalCenter: p.verticalCenter,
    startOnNext: p.startOnNext,
    words: countWords(p.doc),
  }));

/**
 * The page layout of a book whose pages are in memory (Read mode, the print preview, the PDF dialog): the same
 * `bookLayout` Write mode uses, so every surface gives a page the number the PDF prints there.
 */
export function layoutOfPages(
  book: BookLike,
  pages: readonly BookPage[],
  sources: PageSources = {},
): BookPages {
  return bookLayout(book, entryWordsOf(pages), sources);
}

/** The book's print page size and page count (`physical`, blank pages and front and back matter included), and whether every count is measured. */
export function bookPages(
  book: BookLike,
  pages: readonly BookPage[],
  sources: PageSources = {},
): { trimSize: TrimSize; pages: number; exact: boolean } {
  const layout = layoutOfPages(book, pages, sources);
  return { trimSize: resolveTrimSize(book), pages: layout.physical, exact: layout.exact };
}

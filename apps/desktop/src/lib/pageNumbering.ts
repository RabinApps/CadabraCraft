import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { wordsPerPage } from "./printEstimate";

type BookLike = { template: string; trimSize?: TrimSize };

const printOf = (template: string) =>
  getTemplate(hasTemplate(template) ? template : DEFAULT_TEMPLATE_ID).print;

/** Where the template starts a chapter: on a right-hand page, or on the next page. */
export const chapterStart = (book: BookLike): "recto" | "any" =>
  printOf(book.template).chapterOpening.startOn;

/** Words per page for a book's template and trim size. */
export const bookWordsPerPage = (book: BookLike): number =>
  wordsPerPage(
    TRIM_SIZES[resolveTrimSize(book)],
    printOf(book.template).defaults.marginsIn,
    printOf(book.template).fontSizePt,
  );

/** Pages one chapter takes: `ceil(words / words per page)`, at least one. */
export const chapterPageCount = (words: number, perPage: number): number =>
  Math.max(1, Math.ceil(words / perPage));

/**
 * The page number a chapter's first page would have in the PDF, counted from the word-count estimate of the chapters before it:
 * each takes `ceil(words / words per page)` pages (at least one) and, where the template starts chapters on a right-hand page, a
 * blank left-hand page is skipped first. `measured` maps a chapter's index in `wordsBefore` to the page count measured in Page view,
 * which replaces its estimate. The exact number is only known from the PDF (the estimate can be off by a few pages per
 * hundred), so this decides which side of the spread a page falls on, not the printed number to rely on. Front matter is not counted.
 */
export function firstPageNumber(
  book: BookLike,
  wordsBefore: number[],
  measured?: ReadonlyMap<number, number>,
): number {
  const perPage = bookWordsPerPage(book);
  const startsOn = chapterStart(book);
  let page = 1;
  wordsBefore.forEach((words, i) => {
    if (startsOn === "recto" && page % 2 === 0) page += 1;
    page += Math.max(1, measured?.get(i) ?? chapterPageCount(words, perPage));
  });
  return page;
}

/** Pages in all chapters (skipped blank pages included), and whether every chapter's count was measured. 0 pages for no chapters. */
export function bookPageCount(
  book: BookLike,
  words: number[],
  measured?: ReadonlyMap<number, number>,
): { pages: number; exact: boolean } {
  const exact = words.length > 0 && words.every((_, i) => measured?.has(i));
  return { pages: words.length ? firstPageNumber(book, words, measured) - 1 : 0, exact };
}

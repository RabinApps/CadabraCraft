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

/**
 * The page number a chapter's first page would have in the PDF, counted from the word-count estimate of the chapters before it:
 * each takes `ceil(words / words per page)` pages (at least one) and, where the template starts chapters on a right-hand page, a
 * blank left-hand page is skipped first. The exact number is only known from the PDF (the estimate can be off by a few pages per
 * hundred), so this decides which side of the spread a page falls on, not the printed number to rely on. Front matter is not counted.
 */
export function firstPageNumber(book: BookLike, wordsBefore: number[]): number {
  const perPage = wordsPerPage(
    TRIM_SIZES[resolveTrimSize(book)],
    printOf(book.template).defaults.marginsIn,
    printOf(book.template).fontSizePt,
  );
  const startsOn = chapterStart(book);
  let page = 1;
  for (const words of wordsBefore) {
    if (startsOn === "recto" && page % 2 === 0) page += 1;
    page += Math.max(1, Math.ceil(words / perPage));
  }
  return page;
}

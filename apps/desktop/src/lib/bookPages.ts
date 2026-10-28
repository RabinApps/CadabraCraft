import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import type { Manifest } from "@cadabracraft/format";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { estimatePages, wordsPerPage } from "./printEstimate";

/** The book's print page size and the estimated page count for `words`, from its template's margins and type size. An estimate: the PDF is the reference. */
export function bookPages(
  manifest: Pick<Manifest, "template" | "trimSize" | "chapters">,
  words: number,
): { trimSize: TrimSize; pages: number } {
  const trimSize = resolveTrimSize(manifest);
  const print = getTemplate(
    hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID,
  ).print;
  const perPage = wordsPerPage(TRIM_SIZES[trimSize], print.defaults.marginsIn, print.fontSizePt);
  return { trimSize, pages: estimatePages(words, manifest.chapters.length, perPage) };
}

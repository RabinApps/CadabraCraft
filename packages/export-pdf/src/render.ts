import { PdfExportError, TypstCompileError } from "./errors";
import { prepareDocument } from "./prepare";
import type { TypstRunner } from "./runner";
import type { PdfBook, PdfChapter, PdfOptions, RenderResult } from "./types";
import { errMsg } from "@cadabracraft/shared";

export type RenderPdfOptions = PdfOptions;

/**
 * Render chapters to a print PDF using `runner` (see `TypstRunner`; `createNodeRunner` in `./node` for Node).
 * Refuses (FontNotAvailableError) when a requested font is not installed; never substitutes one.
 */
export async function renderPdf(
  book: PdfBook,
  chapters: PdfChapter[],
  options: RenderPdfOptions,
  runner: TypstRunner,
): Promise<RenderResult> {
  const { source, files, fonts } = await prepareDocument(book, chapters, options, runner);
  let pdf: Uint8Array;
  try {
    pdf = await runner.compile(source, files, {
      pdfA: options.pdfA === true,
      pdfUa: options.pdfUa === true,
    });
  } catch (e) {
    throw e instanceof PdfExportError ? e : new TypstCompileError(errMsg(e));
  }
  return { pdf, fonts };
}

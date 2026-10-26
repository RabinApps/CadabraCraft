import { MissingAssetError, PdfExportError, TypstCompileError } from "./errors";
import type { TypstRunner } from "./runner";
import type { PdfBook, PdfChapter, PdfOptions, RenderResult } from "./types";
import { buildTypstDocument, resolveFonts } from "./typst";
import { errMsg } from "@cadabracraft/shared";

export type RenderPdfOptions = PdfOptions;

/**
 * Render chapters to a print PDF using `runner` (see `TypstRunner`; `createNodeRunner` in `./node` for Node).
 * Refuses (FontNotAvailableError) when a requested font is not installed; never substitutes one.
 */
export async function renderPdf(book: PdfBook, chapters: PdfChapter[], options: RenderPdfOptions, runner: TypstRunner): Promise<RenderResult> {
  const available = await runner.listFonts();
  const fonts = resolveFonts(options, available);
  const doc = buildTypstDocument(book, chapters, options, fonts);

  const missing = [...doc.images.keys()].filter((src) => !options.assets || !(src in options.assets));
  if (missing.length) throw new MissingAssetError(missing);

  const files = new Map<string, Uint8Array>();
  for (const [src, rel] of doc.images) files.set(rel, options.assets![src]!);
  let pdf: Uint8Array;
  try {
    pdf = await runner.compile(doc.source, files, { pdfA: options.pdfA === true });
  } catch (e) {
    throw e instanceof PdfExportError ? e : new TypstCompileError(errMsg(e));
  }
  return { pdf, fonts };
}

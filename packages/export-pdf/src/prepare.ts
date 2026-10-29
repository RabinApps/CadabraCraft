import { MissingAssetError } from "./errors";
import type { TypstRunner } from "./runner";
import type { FontChoice, PdfBook, PdfChapter, PdfOptions } from "./types";
import { buildTypstDocument, resolveFonts } from "./typst";
import { DROPLET_FILES } from "./vendor/droplet";

export interface PreparedDocument {
  source: string;
  /** Files the source expects next to it (images, vendored packages). */
  files: Map<string, Uint8Array>;
  fonts: FontChoice;
}

/**
 * Resolve fonts, generate the Typst source and gather the files it needs. Shared by `renderPdf` and `measurePages`.
 * Refuses (FontNotAvailableError) when a requested font is not installed; throws MissingAssetError for images not in `options.assets`.
 */
export async function prepareDocument(
  book: PdfBook,
  chapters: PdfChapter[],
  options: PdfOptions,
  runner: TypstRunner,
): Promise<PreparedDocument> {
  const available = await runner.listFonts();
  const fonts = resolveFonts(options, available);
  const doc = buildTypstDocument(book, chapters, options, fonts);

  const missing = [...doc.images.keys()].filter(
    (src) => !options.assets || !(src in options.assets),
  );
  if (missing.length) throw new MissingAssetError(missing);

  const files = new Map<string, Uint8Array>();
  for (const [src, rel] of doc.images) files.set(rel, options.assets![src]!);
  if (doc.usesDropCap)
    for (const [rel, text] of Object.entries(DROPLET_FILES))
      files.set(rel, new TextEncoder().encode(text));
  return { source: doc.source, files, fonts };
}

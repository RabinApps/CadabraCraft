import {
  TRIM_SIZES,
  type FontChoice,
  type PdfBook,
  type PdfChapter,
  type PdfOptions,
  type TypstDocument,
} from "../types";
import { PdfExportError } from "../errors";
import type { Ctx } from "./ctx";
import { bodyOf, coverPage } from "./matter";
import { resolveFonts, resolveMargins, resolveTemplate } from "./options";
import { preamble } from "./preamble";

export { requestedFonts, resolveFonts, resolveTemplate } from "./options";

/** Typst document plus the image paths it expects (relative to the compile directory). */
export function buildTypstDocument(
  book: PdfBook,
  chapters: PdfChapter[],
  options: PdfOptions = {},
  fonts?: FontChoice,
): TypstDocument {
  const t = resolveTemplate(options);
  const resolved = fonts ?? resolveFonts(options);
  const margins = resolveMargins(options, t);
  const trim = TRIM_SIZES[options.trimSize ?? t.print.defaults.trimSize];
  if (!trim) throw new PdfExportError(`Unknown trim size "${String(options.trimSize)}"`);
  const ctx: Ctx = {
    images: new Map(),
    maxImageIn: Math.max(1, trim.h - margins.top - margins.bottom - 1),
    assets: options.assets,
  };
  const head = preamble(
    book,
    t,
    options,
    resolved,
    margins,
    chapters.some((c) => (c.section ?? "chapter") === "front"),
  );
  const cover = options.cover === undefined ? "" : coverPage(options.cover, ctx);
  const body = bodyOf(
    chapters,
    ctx,
    t.print.chapterOpening.dropCap,
    t.print.paragraph.style === "indent" ? t.print.paragraph.indentEm : 0,
  );
  const droplet = ctx.usesDropCap ? '#import "typst-droplet/lib.typ": dropcap\n' : "";
  return {
    source: `${head}\n${droplet}${cover}${body}`,
    images: ctx.images,
    fonts: resolved,
    usesDropCap: ctx.usesDropCap === true,
  };
}

/** Pure: chapter JSON -> Typst source. No I/O, no font availability check (see `renderPdf`). */
export function buildTypst(
  book: PdfBook,
  chapters: PdfChapter[],
  options: PdfOptions = {},
): string {
  return buildTypstDocument(book, chapters, options).source;
}

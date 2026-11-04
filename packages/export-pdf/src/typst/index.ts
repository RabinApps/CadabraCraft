import {
  TRIM_SIZES,
  type CharMark,
  type FontChoice,
  type PdfBook,
  type PdfChapter,
  type PdfOptions,
  type TypstDocument,
} from "../types";
import { PdfExportError } from "../errors";
import type { Ctx } from "./ctx";
import { coverAlt } from "../strings";
import { bodyOf, coverPage } from "./matter";
import { resolveFonts, resolveMargins, resolveTemplate } from "./options";
import { preamble } from "./preamble";
import { pageReport } from "./report";
import { tocDefs, tocEntries, tocHeadingKeys } from "./toc";

export { requestedFonts, resolveFonts, resolveTemplate } from "./options";

/** `PdfOptions.charMarks` as the words to mark inside, by `chapter:block:leaf`. */
function charMarkWords(marks: CharMark[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const m of marks) {
    const key = `${m.chapter}:${m.block}:${m.leaf}`;
    out.set(key, (out.get(key) ?? new Set()).add(m.word));
  }
  return out;
}

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
    coverAlt: coverAlt(book.language),
    headingNo: 0,
    ...(options.blockMarks ? { marks: true } : {}),
    ...(options.charMarks ? { charMarks: charMarkWords(options.charMarks) } : {}),
  };
  const hasContents = chapters.some((c) => c.kind === "contents" && c.section === "front");
  if (options.toc && hasContents) {
    ctx.tocEntries = tocEntries(options.toc.items);
    ctx.tocHeadings = tocHeadingKeys(options.toc.items);
  }
  const hasFront = chapters.some((c) => (c.section ?? "chapter") === "front");
  const head = preamble(book, t, options, resolved, margins, hasFront);
  const cover = options.cover === undefined ? "" : coverPage(options.cover, ctx);
  const body = bodyOf(
    chapters,
    ctx,
    t.print.chapterOpening.dropCap,
    t.print.paragraph.style === "indent" ? t.print.paragraph.indentEm : 0,
    t,
  );
  const tocHead = hasContents
    ? tocDefs(
        t.print.chapterOpening.sinkEm,
        (options.toc?.pageNumbers ?? true) && (options.pageNumbers ?? true),
      )
    : "";
  const droplet = ctx.usesDropCap ? '#import "typst-droplet/lib.typ": dropcap\n' : "";
  return {
    source: `${head}\n${tocHead}${droplet}${cover}${body}${pageReport(hasFront, options.pageNumbers ?? true, options.blockMarks === true)}`,
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

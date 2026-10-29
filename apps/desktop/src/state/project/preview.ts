import { renderPdf } from "@cadabracraft/export-pdf";
import { contentHash } from "@cadabracraft/export-audio";
import { getTemplate } from "@cadabracraft/templates";
import { bridge } from "../../lib/bridge";
import { describePdfError } from "../../lib/pdfErrors";
import { createTauriRunner } from "../../lib/typstRunner";
import type { Ctx } from "./context";
import type { ExportActions } from "./types";
import type { createTypstBook } from "./typstBook";

/** PDFs kept for the print preview: toggling bleed on and off, or going back to a trim size, costs no Typst run. */
export const PREVIEW_CACHE_SIZE = 3;

/** The real PDF for the print preview: the same Typst run as the export, kept in memory and never written to the book. */
export const createPreviewActions = (
  ctx: Ctx,
  gather: ReturnType<typeof createTypstBook>,
): Pick<ExportActions, "renderPreview"> => {
  const { need, loadCover } = ctx;
  /** Most recent last. */
  const cache = new Map<string, Uint8Array>();
  return {
    async renderPreview({ trimSize, bleedIn, cropMarks }) {
      try {
        need();
        const book = await gather();
        const size = trimSize ?? book.trimSize;
        const cover = await loadCover(book.edition.cover);
        const key = contentHash(
          JSON.stringify([
            book.templateId,
            size,
            book.fonts,
            bleedIn,
            cropMarks,
            cover ? [cover.path, cover.bytes.length] : null,
            book.edition.title,
            book.edition.author,
            book.edition.language,
            book.chapters,
          ]),
        );
        const hit = cache.get(key);
        if (hit) {
          cache.delete(key);
          cache.set(key, hit);
          return hit;
        }
        const assets = await book.assets();
        if (cover) assets.set(cover.path, cover.bytes);
        const { pdf } = await renderPdf(
          {
            title: book.edition.title,
            author: book.edition.author,
            language: book.edition.language,
          },
          book.chapters,
          {
            template: getTemplate(book.templateId),
            trimSize: size,
            mirrored: true,
            pageNumbers: true,
            pdfA: false,
            ...(bleedIn ? { bleedIn } : {}),
            ...(cropMarks ? { cropMarks: true } : {}),
            ...(Object.keys(book.fonts).length ? { fonts: book.fonts } : {}),
            assets: Object.fromEntries(assets),
            ...(cover ? { cover: cover.path } : {}),
          },
          createTauriRunner(bridge),
        );
        cache.set(key, pdf);
        while (cache.size > PREVIEW_CACHE_SIZE) cache.delete(cache.keys().next().value!);
        return pdf;
      } catch (e) {
        throw describePdfError(e);
      }
    },
  };
};

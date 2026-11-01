import { measurePages, renderPdf, type PageReport } from "@cadabracraft/export-pdf";
import { contentHash } from "@cadabracraft/export-audio";
import { getTemplate } from "@cadabracraft/templates";
import { bridge } from "../../lib/bridge";
import { describePdfError } from "../../lib/pdfErrors";
import { pageTarget } from "../../lib/previewTarget";
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
): Pick<ExportActions, "renderPreview" | "previewTarget"> => {
  const { need, loadCover } = ctx;
  /** Most recent last. */
  const cache = new Map<string, Uint8Array>();
  /** The page report of the preview's layout (with block marks), for the last preview a page was clicked in. */
  let lastReport: { key: string; report: PageReport } | null = null;

  /** The book as the preview typesets it: a key for the content and choices, and the arguments of the Typst run (assets are read when it is built). */
  const prepare = async ({
    trimSize,
    bleedIn,
    cropMarks,
  }: Parameters<ExportActions["renderPreview"]>[0]) => {
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
        book.toc,
      ]),
    );
    const build = async () => {
      const assets = await book.assets();
      if (cover) assets.set(cover.path, cover.bytes);
      return {
        book: {
          title: book.edition.title,
          author: book.edition.author,
          language: book.edition.language,
        },
        chapters: book.chapters,
        options: {
          template: getTemplate(book.templateId),
          trimSize: size,
          mirrored: true,
          pageNumbers: true,
          pdfA: false,
          ...(bleedIn ? { bleedIn } : {}),
          ...(cropMarks ? { cropMarks: true } : {}),
          ...(Object.keys(book.fonts).length ? { fonts: book.fonts } : {}),
          ...(book.toc ? { toc: book.toc } : {}),
          assets: Object.fromEntries(assets),
          ...(cover ? { cover: cover.path } : {}),
        },
      };
    };
    return { key, build };
  };

  return {
    async renderPreview(options) {
      try {
        const { key, build } = await prepare(options);
        const hit = cache.get(key);
        if (hit) {
          cache.delete(key);
          cache.set(key, hit);
          return hit;
        }
        const job = await build();
        const { pdf } = await renderPdf(
          job.book,
          job.chapters,
          job.options,
          createTauriRunner(bridge),
        );
        cache.set(key, pdf);
        while (cache.size > PREVIEW_CACHE_SIZE) cache.delete(cache.keys().next().value!);
        return pdf;
      } catch (e) {
        throw describePdfError(e);
      }
    },
    async previewTarget({ page, ...options }) {
      try {
        const { key, build } = await prepare(options);
        if (lastReport?.key !== key) {
          const job = await build();
          // The same run as the preview's PDF (cover, bleed and all), asked for its layout instead of its pages.
          const report = await measurePages(
            job.book,
            job.chapters,
            { ...job.options, blockMarks: true },
            createTauriRunner(bridge),
          );
          lastReport = { key, report };
        }
        return pageTarget(lastReport.report, page);
      } catch (e) {
        throw describePdfError(e);
      }
    },
  };
};

import { renderPdf, type PageReport, TRIM_SIZES } from "@cadabracraft/export-pdf";
import { getTemplate } from "@cadabracraft/templates";
import { t } from "@lingui/core/macro";
import { bridge } from "../../lib/bridge";
import { describePdfError, PdfUiError } from "../../lib/pdfErrors";
import { typstKey } from "../../lib/tocPreview";
import { createTauriRunner } from "../../lib/typstRunner";
import type { Ctx } from "./context";
import type { ContentsPreview, ExportActions } from "./types";
import type { createTypstBook } from "./typstBook";

/** Contents previews kept: going back to a list that was drawn a moment ago costs no Typst run. */
export const CONTENTS_CACHE_SIZE = 3;

/**
 * The contents page as printed, for the preview beside the Contents editor. It is the print preview's book (`gather`: the open
 * page's draft included, the resolved list, no cover, no bleed), typeset by the same Typst run as the PDF; the page report says
 * which physical pages the contents page has, and the view draws only those. Nothing is written to the book and the export is
 * not touched. The whole book is typeset because the numbers on the list are where the other pages land. The page range comes from
 * the store's page measure (a content-hash cache shared with the status bar, so it is a run only when nobody has measured this
 * text yet); the PDF drawn is a second run because `renderPdf` returns no page report (a follow-up in export-pdf would make it one).
 */
export const createContentsPreviewActions = (
  ctx: Ctx,
  gather: ReturnType<typeof createTypstBook>,
  /** The store's cached page measure of the book as gathered (shared with the status bar), so the page range costs no run of its own. */
  measure: (book: Awaited<ReturnType<typeof gather>>) => Promise<PageReport>,
): Pick<ExportActions, "renderContentsPreview"> => {
  /** Most recent last. */
  const cache = new Map<string, Extract<ContentsPreview, { kind: "typst" }>>();
  return {
    async renderContentsPreview() {
      try {
        ctx.need();
        const book = await gather();
        const contents = book.chapters.find((c) => c.kind === "contents");
        if (!book.toc || !contents)
          throw new PdfUiError("other", t`This edition has no contents page to draw.`);
        const key = typstKey([
          book.templateId,
          book.trimSize,
          book.fonts,
          book.edition.title,
          book.edition.author,
          book.edition.language,
          book.chapters,
          book.toc,
        ]);
        const hit = cache.get(key);
        if (hit) {
          cache.delete(key);
          cache.set(key, hit);
          return hit;
        }
        const meta = {
          title: book.edition.title,
          author: book.edition.author,
          language: book.edition.language,
        };
        const options = {
          template: getTemplate(book.templateId),
          trimSize: book.trimSize,
          mirrored: true,
          pageNumbers: true,
          pdfA: false,
          ...(Object.keys(book.fonts).length ? { fonts: book.fonts } : {}),
          toc: book.toc,
          assets: Object.fromEntries(await book.assets()),
        };
        const runner = createTauriRunner(bridge);
        const report = await measure(book);
        const start = report.starts.find((s) => s.id === contents.id);
        if (!start) throw new PdfUiError("other", t`The contents page is not in the typeset book.`);
        const { pdf } = await renderPdf(meta, book.chapters, options, runner);
        const result = {
          kind: "typst" as const,
          key,
          pdf,
          first: start.page,
          last: start.end,
          trim: TRIM_SIZES[book.trimSize],
        };
        cache.set(key, result);
        while (cache.size > CONTENTS_CACHE_SIZE) cache.delete(cache.keys().next().value!);
        return result;
      } catch (e) {
        const error = describePdfError(e);
        // Typst is not installed: the view draws its own approximation instead of reporting a failure.
        if (error.code === "typst-missing") return { kind: "unavailable" };
        throw error;
      }
    },
  };
};

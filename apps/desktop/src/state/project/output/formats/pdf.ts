import { t } from "@lingui/core/macro";
import { renderPdf } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveBookFonts,
} from "@cadabracraft/templates";
import { bridge } from "../../../../lib/bridge";
import { describePdfError } from "../../../../lib/export/pdfErrors";
import { createTauriRunner } from "../../../../lib/export/typstRunner";
import { bookContents, pdfToc } from "../../../../lib/export/tocExport";
import type { ExportActions } from "../../types";
import type { Ctx } from "../../context";
import { left } from "./shared";

/** The print PDF export. */
export const createPdfActions = (ctx: Ctx): Pick<ExportActions, "exportPdf"> => {
  const { set, get, need, saveManifest, flush, loadExportPages, loadAssets, loadCover } = ctx;
  return {
    async exportPdf(options) {
      if (get().exportStage) throw new Error(t`A PDF export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const templateId = hasTemplate(options.template) ? options.template : DEFAULT_TEMPLATE_ID;
        const template = getTemplate(templateId);
        const { edition, pages: chapters, dir, skipped } = await loadExportPages(options);
        const assets = await loadAssets(chapters);
        const cover = options.cover === false ? undefined : await loadCover(edition.cover);
        if (cover) assets.set(cover.path, cover.bytes);
        set({ exportStage: "rendering" });
        const runner = createTauriRunner(bridge);
        const toc = pdfToc(bookContents(manifest, edition.language, chapters));
        // The book's own choice unless the caller names fonts; only the keys that are set (the rest follow the template).
        const fonts = options.fonts ?? resolveBookFonts(manifest);
        const { pdf } = await renderPdf(
          { title: edition.title, author: edition.author, language: edition.language },
          chapters,
          {
            template,
            trimSize: options.trimSize,
            mirrored: true,
            pageNumbers: true,
            pdfA: options.pdfA,
            pdfUa: options.pdfUa === true,
            ...(options.bleedIn ? { bleedIn: options.bleedIn } : {}),
            ...(options.cropMarks ? { cropMarks: true } : {}),
            ...(Object.keys(fonts).length ? { fonts } : {}),
            ...(toc ? { toc } : {}),
            assets: Object.fromEntries(assets),
            ...(cover ? { cover: cover.path } : {}),
          },
          runner,
        );
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, `${dir}/book.pdf`, pdf);
        if (manifest.template !== templateId)
          await saveManifest({ ...need().manifest, template: templateId });
        set({ notice: t`Exported ${dir}/book.pdf` + left(skipped.length) });
      } catch (e) {
        throw describePdfError(e);
      } finally {
        set({ exportStage: null });
      }
    },
  };
};

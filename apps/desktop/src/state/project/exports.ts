import { sourceEdition, sourceFileById } from "@cadabracraft/format";
import { t } from "@lingui/core/macro";
import { buildEpub } from "@cadabracraft/export-epub";
import { buildDocx } from "@cadabracraft/export-docx";
import {
  bookToMarkdown,
  chapterToMarkdown,
  MarkdownExportError,
} from "@cadabracraft/export-markdown";
import { renderPdf } from "@cadabracraft/export-pdf";
import { DEFAULT_TEMPLATE_ID, getTemplate, hasTemplate } from "@cadabracraft/templates";
import { bridge } from "../../lib/bridge";
import { describePdfError } from "../../lib/pdfErrors";
import { describeEpubError } from "../../lib/epubErrors";
import { createTauriRunner } from "../../lib/typstRunner";
import type { ExportActions } from "./types";
import type { Ctx } from "./context";

/** The one-shot exports: EPUB, Markdown, Word and the print PDF. */
export const createExportActions = (ctx: Ctx): ExportActions => {
  const { set, get, need, saveManifest, flush, loadChapters, loadAssets, loadCover } = ctx;
  return {
    async exportEpub() {
      if (get().exportStage) throw new Error(t`An export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const chapters = await loadChapters();
        const assets = await loadAssets(chapters);
        const cover = await loadCover();
        set({ exportStage: "rendering" });
        const bytes = buildEpub(
          {
            title: sourceEdition(manifest.editions).title,
            author: sourceEdition(manifest.editions).author,
            language: sourceEdition(manifest.editions).language,
            identifier: sourceEdition(manifest.editions).identifier,
            isbn: sourceEdition(manifest.editions).isbn,
            modified: new Date(),
          },
          chapters,
          {
            assets,
            cover,
            css: getTemplate(
              hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID,
            ).epub.css,
          },
        );
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, "exports/book.epub", bytes);
        set({ notice: t`Exported exports/book.epub` });
      } catch (e) {
        const manifest = get().manifest;
        throw describeEpubError(e, (id) => (manifest ? sourceFileById(manifest, id) : undefined));
      } finally {
        set({ exportStage: null });
      }
    },
    async exportMarkdown({ htmlMarks }) {
      if (get().exportStage) throw new Error(t`An export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const chapters = await loadChapters();
        // An empty book would write an empty file and still report success.
        if (!chapters.length)
          throw new Error(t`The book has no pages to export yet. Add a chapter first.`);
        set({ exportStage: "rendering" });
        const opts = { htmlMarks, imageBase: "../" };
        let markdown: string;
        try {
          markdown = bookToMarkdown(
            {
              title: sourceEdition(manifest.editions).title,
              author: sourceEdition(manifest.editions).author,
            },
            chapters,
            opts,
          );
        } catch (e) {
          if (!(e instanceof MarkdownExportError)) throw e;
          // The library's message does not say where; find the first page that fails so the author can.
          const bad = chapters.find((c) => {
            try {
              chapterToMarkdown(c.doc, opts);
              return false;
            } catch {
              return true;
            }
          });
          // A page with an empty title is named by its file instead.
          const where = bad ? bad.title.trim() || sourceFileById(manifest, bad.id) || "" : "";
          throw new Error(where ? t`In “${where}”: ${e.message}` : e.message, { cause: e });
        }
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, "exports/book.md", new TextEncoder().encode(markdown));
        set({ notice: t`Exported exports/book.md` });
      } finally {
        set({ exportStage: null });
      }
    },
    async exportDocx({ font }) {
      if (get().exportStage) throw new Error(t`An export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const chapters = await loadChapters();
        // An empty book would write a title page only and still report success.
        if (!chapters.length)
          throw new Error(t`The book has no pages to export yet. Add a chapter first.`);
        const assets = await loadAssets(chapters);
        set({ exportStage: "rendering" });
        // A page with an empty title is named by its file in error messages.
        const pages = chapters.map((c) => ({ ...c, id: sourceFileById(manifest, c.id) ?? c.id }));
        const bytes = buildDocx(
          {
            title: sourceEdition(manifest.editions).title,
            author: sourceEdition(manifest.editions).author,
            language: sourceEdition(manifest.editions).language,
          },
          pages,
          { assets, font, modified: new Date() },
        );
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, "exports/manuscript.docx", bytes);
        set({ notice: t`Exported exports/manuscript.docx` });
      } finally {
        set({ exportStage: null });
      }
    },
    async exportPdf(options) {
      if (get().exportStage) throw new Error(t`A PDF export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const templateId = hasTemplate(options.template) ? options.template : DEFAULT_TEMPLATE_ID;
        const template = getTemplate(templateId);
        const chapters = await loadChapters();
        const assets = await loadAssets(chapters);
        const cover = options.cover === false ? undefined : await loadCover();
        if (cover) assets.set(cover.path, cover.bytes);
        set({ exportStage: "rendering" });
        const runner = createTauriRunner(bridge, options.typstPath);
        const { pdf } = await renderPdf(
          {
            title: sourceEdition(manifest.editions).title,
            author: sourceEdition(manifest.editions).author,
            language: sourceEdition(manifest.editions).language,
          },
          chapters,
          {
            template,
            trimSize: options.trimSize,
            mirrored: true,
            pageNumbers: true,
            pdfA: options.pdfA,
            assets: Object.fromEntries(assets),
            ...(cover ? { cover: cover.path } : {}),
          },
          runner,
        );
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, "exports/book.pdf", pdf);
        if (manifest.template !== templateId)
          await saveManifest({ ...need().manifest, template: templateId });
        set({ notice: t`Exported exports/book.pdf` });
      } catch (e) {
        throw describePdfError(e);
      } finally {
        set({ exportStage: null });
      }
    },
  };
};

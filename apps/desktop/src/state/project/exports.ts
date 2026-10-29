import { sourceEdition, sourceFileById } from "@cadabracraft/format";
import { plural, t } from "@lingui/core/macro";
import { buildEpub } from "@cadabracraft/export-epub";
import { buildDocx } from "@cadabracraft/export-docx";
import {
  bookToMarkdown,
  chapterToMarkdown,
  MarkdownExportError,
} from "@cadabracraft/export-markdown";
import { measurePages, renderPdf, type PageReport } from "@cadabracraft/export-pdf";
import { contentHash } from "@cadabracraft/export-audio";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveBookFonts,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { bridge } from "../../lib/bridge";
import { describePdfError } from "../../lib/pdfErrors";
import { describeEpubError } from "../../lib/epubErrors";
import { createTauriRunner } from "../../lib/typstRunner";
import type { ExportActions } from "./types";
import type { Ctx } from "./context";

/** The one-shot exports: EPUB, Markdown, Word and the print PDF. */
export const createExportActions = (ctx: Ctx): ExportActions => {
  const { set, get, need, saveManifest, flush, loadExportPages, loadAssets, loadCover } = ctx;
  /** " (N untranslated pages left out)" for the notice, or nothing when every page was exported. */
  const left = (n: number) =>
    n
      ? ` (${plural(n, { one: "# untranslated page left out", other: "# untranslated pages left out" })})`
      : "";
  /** The last measure: reused while the book, template, trim size and fonts are the same. */
  let lastMeasure: { key: string; report: PageReport } | null = null;
  return {
    async measurePages() {
      try {
        const { manifest } = need();
        const currentId = get().currentId;
        const templateId = hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID;
        const { edition, pages } = await loadExportPages();
        // The open page's text is in the draft until it is saved, so measure that instead of the file.
        const open = get().draft ?? get().currentDoc;
        const source = sourceEdition(manifest.editions).language;
        const chapters =
          open && currentId && (get().activeLanguage ?? source) === source
            ? pages.map((p) => (p.id === currentId ? { ...p, doc: open } : p))
            : pages;
        const trimSize = resolveTrimSize(manifest);
        const fonts = resolveBookFonts(manifest);
        const key = contentHash(
          JSON.stringify([templateId, trimSize, fonts, edition.title, chapters]),
        );
        if (lastMeasure?.key === key) return lastMeasure.report;
        const assets = await loadAssets(chapters);
        const report = await measurePages(
          { title: edition.title, author: edition.author, language: edition.language },
          chapters,
          {
            template: getTemplate(templateId),
            trimSize,
            mirrored: true,
            pageNumbers: true,
            pdfA: false,
            ...(Object.keys(fonts).length ? { fonts } : {}),
            assets: Object.fromEntries(assets),
          },
          createTauriRunner(bridge),
        );
        lastMeasure = { key, report };
        return report;
      } catch (e) {
        throw describePdfError(e);
      }
    },
    async exportEpub(scope) {
      if (get().exportStage) throw new Error(t`An export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const { edition, pages: chapters, dir, skipped } = await loadExportPages(scope);
        const assets = await loadAssets(chapters);
        const cover = await loadCover(edition.cover);
        set({ exportStage: "rendering" });
        const bytes = buildEpub(
          {
            title: edition.title,
            author: edition.author,
            language: edition.language,
            identifier: edition.identifier,
            isbn: edition.isbn,
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
        await bridge.writeBytes(root, `${dir}/book.epub`, bytes);
        set({ notice: t`Exported ${dir}/book.epub` + left(skipped.length) });
      } catch (e) {
        const manifest = get().manifest;
        throw describeEpubError(e, (id) => (manifest ? sourceFileById(manifest, id) : undefined));
      } finally {
        set({ exportStage: null });
      }
    },
    async exportMarkdown({ htmlMarks, ...scope }) {
      if (get().exportStage) throw new Error(t`An export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const { edition, pages: chapters, dir, skipped } = await loadExportPages(scope);
        // An empty book would write an empty file and still report success.
        if (!chapters.length)
          throw new Error(t`The book has no pages to export yet. Add a chapter first.`);
        set({ exportStage: "rendering" });
        const opts = { htmlMarks, imageBase: "../" };
        let markdown: string;
        try {
          markdown = bookToMarkdown(
            { title: edition.title, author: edition.author },
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
          const where = bad && (bad.title.trim() || sourceFileById(manifest, bad.id)!);
          throw new Error(where ? t`In “${where}”: ${e.message}` : e.message, { cause: e });
        }
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, `${dir}/book.md`, new TextEncoder().encode(markdown));
        set({ notice: t`Exported ${dir}/book.md` + left(skipped.length) });
      } finally {
        set({ exportStage: null });
      }
    },
    async exportDocx({ font, ...scope }) {
      if (get().exportStage) throw new Error(t`An export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root, manifest } = need();
        const { edition, pages: chapters, dir, skipped } = await loadExportPages(scope);
        // An empty book would write a title page only and still report success.
        if (!chapters.length)
          throw new Error(t`The book has no pages to export yet. Add a chapter first.`);
        const assets = await loadAssets(chapters);
        set({ exportStage: "rendering" });
        // A page with an empty title is named by its file in error messages.
        const pages = chapters.map((c) => ({ ...c, id: sourceFileById(manifest, c.id)! }));
        const bytes = buildDocx(
          { title: edition.title, author: edition.author, language: edition.language },
          pages,
          { assets, font, modified: new Date() },
        );
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, `${dir}/manuscript.docx`, bytes);
        set({ notice: t`Exported ${dir}/manuscript.docx` + left(skipped.length) });
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
        const { edition, pages: chapters, dir, skipped } = await loadExportPages(options);
        const assets = await loadAssets(chapters);
        const cover = options.cover === false ? undefined : await loadCover(edition.cover);
        if (cover) assets.set(cover.path, cover.bytes);
        set({ exportStage: "rendering" });
        const runner = createTauriRunner(bridge);
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
            ...(Object.keys(fonts).length ? { fonts } : {}),
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

import { isCodexFile, sourceFileById } from "@cadabracraft/format";
import { plural, t } from "@lingui/core/macro";
import { buildEpub } from "@cadabracraft/export-epub";
import { buildDocx } from "@cadabracraft/export-docx";
import { buildRtf } from "@cadabracraft/export-rtf";
import {
  bookToMarkdown,
  chapterToMarkdown,
  MarkdownExportError,
} from "@cadabracraft/export-markdown";
import { measurePages, renderPdf, type PageReport } from "@cadabracraft/export-pdf";
import { contentHash } from "@cadabracraft/export-audio";
import { OUTLINE_FORMATS, buildOutline, serializeOutline } from "@cadabracraft/outline";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  resolveDropCap,
  hasTemplate,
  resolveBookFonts,
} from "@cadabracraft/templates";
import { bridge } from "../../lib/bridge";
import { describePdfError } from "../../lib/pdfErrors";
import { describeEpubError } from "../../lib/epubErrors";
import { createTauriRunner } from "../../lib/typstRunner";
import { bookContents, pdfToc } from "../../lib/tocExport";
import type { ExportActions, ExportScope } from "./types";
import type { Ctx } from "./context";
import { createContentsPreviewActions } from "./contentsPreview";
import { createPreviewActions } from "./preview";
import { createTypstBook } from "./typstBook";

/** The one-shot exports: EPUB, Markdown, Word, Rich Text and the print PDF. */
export const createExportActions = (ctx: Ctx): ExportActions => {
  const { set, get, need, saveManifest, flush, loadExportPages, loadAssets, loadCover } = ctx;
  /** " (N untranslated pages left out)" for the notice, or nothing when every page was exported. */
  const left = (n: number) =>
    n
      ? ` (${plural(n, { one: "# untranslated page left out", other: "# untranslated pages left out" })})`
      : "";
  /** Loads the pages and images, runs `build` and writes `exports/<language>/<file>`; shared by the Word and Rich Text manuscripts. */
  const writeManuscript = async (
    scope: ExportScope,
    file: string,
    build: (
      book: { title: string; author: string; language: string },
      pages: Parameters<typeof buildDocx>[1],
      assets: Map<string, Uint8Array>,
      contents: ReturnType<typeof bookContents>,
    ) => Uint8Array,
  ) => {
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
      const contents = bookContents(manifest, edition.language, chapters);
      // A page with an empty title is named by its file in error messages.
      const pages = chapters.map((c) => ({ ...c, id: sourceFileById(manifest, c.id)! }));
      const bytes = build(
        { title: edition.title, author: edition.author, language: edition.language },
        pages,
        assets,
        contents,
      );
      set({ exportStage: "saving" });
      await bridge.writeBytes(root, `${dir}/${file}`, bytes);
      return { dir, skipped };
    } finally {
      set({ exportStage: null });
    }
  };
  const gather = createTypstBook(ctx);
  /** The last measure of each thing measured (the whole book, with or without marks, or a page by its id): the last result is reused while the book is the same. */
  const measured = new Map<string, { key: string; report: PageReport }>();
  /** Measures running now, by slot and content: a second asker (the status bar and the contents preview) waits for the same run. */
  const running = new Map<string, Promise<PageReport>>();
  /** Typst's page report for a book as `gather` returned it; one Typst run per distinct content however many callers ask. */
  const measureBook = async (
    book: Awaited<ReturnType<typeof gather>>,
    slot: string,
    marks: boolean,
  ): Promise<PageReport> => {
    const { templateId, edition, chapters, trimSize, fonts, toc, assets: load } = book;
    const key = contentHash(
      JSON.stringify([templateId, trimSize, fonts, edition.title, edition.language, chapters, toc]),
    );
    const last = measured.get(slot);
    if (last?.key === key) return last.report;
    const id = `${slot}\n${key}`;
    const under = running.get(id);
    if (under) return under;
    const run = (async () => {
      const assets = await load();
      const report = await measurePages(
        { title: edition.title, author: edition.author, language: edition.language },
        chapters,
        {
          template: getTemplate(templateId),
          trimSize,
          mirrored: true,
          pageNumbers: true,
          pdfA: false,
          // Page view draws the pages Typst broke inside each chapter; marking every word of a book costs about a second per
          // 100,000 words, so only the measures that need the breaks ask for it.
          ...(marks ? { blockMarks: true } : {}),
          ...(Object.keys(fonts).length ? { fonts } : {}),
          ...(toc ? { toc } : {}),
          assets: Object.fromEntries(assets),
        },
        createTauriRunner(bridge),
      );
      measured.set(slot, { key, report });
      return report;
    })();
    running.set(id, run);
    try {
      return await run;
    } finally {
      running.delete(id);
    }
  };
  const measure = async (only?: string, marks = true): Promise<PageReport> => {
    try {
      // The open page's text is in the draft until it is saved, so measure that instead of the file.
      return await measureBook(await gather(only), only ?? (marks ? "book" : "book-plain"), marks);
    } catch (e) {
      throw describePdfError(e);
    }
  };
  return {
    ...createPreviewActions(ctx, gather),
    ...createContentsPreviewActions(ctx, gather, (book) => measureBook(book, "book-plain", false)),
    measurePages: (options) => measure(undefined, options?.marks ?? false),
    measureChapter: (id) => measure(id),
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
        const contents = bookContents(manifest, edition.language, chapters);
        const template = getTemplate(
          hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID,
        );
        const bytes = buildEpub(
          {
            title: edition.title,
            author: edition.author,
            language: edition.language,
            identifier: edition.identifier,
            isbn: edition.isbn,
            publishing: edition.publishing,
            modified: new Date(),
          },
          chapters,
          {
            assets,
            cover,
            ...(contents ? { contents: contents.visible } : {}),
            css: template.epub.css,
            dropCap: resolveDropCap(template, manifest, {}),
            centerKinds: template.print.matter.verticalCenter,
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
        const contents = bookContents(manifest, edition.language, chapters);
        let markdown: string;
        try {
          markdown = bookToMarkdown(
            { title: edition.title, author: edition.author },
            chapters,
            opts,
            contents && { items: contents.visible },
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
    async exportOutline({ format, ...scope }) {
      if (get().exportStage) throw new Error(t`An export is already running`);
      set({ exportStage: "preparing" });
      try {
        await flush();
        const { root } = need();
        const { edition, pages, dir, skipped } = await loadExportPages(scope);
        const chapters = pages.filter((p) => p.section === "chapter" && p.kind !== "part");
        // An empty book would write an empty file and still report success.
        if (!chapters.length)
          throw new Error(t`The book has no chapters to export yet. Add a chapter first.`);
        // The codex only names the cast; a missing or unreadable one leaves the ids in place.
        const codex = await bridge
          .readFile(root, "codex.json")
          .then((r) => {
            const parsed: unknown = r ? JSON.parse(r.contents) : null;
            return isCodexFile(parsed) ? parsed.entries : [];
          })
          .catch(() => []);
        set({ exportStage: "rendering" });
        const text = serializeOutline(
          buildOutline({ title: edition.title, author: edition.author }, chapters, codex),
          format,
        );
        const file = `${dir}/${OUTLINE_FORMATS[format].file}`;
        set({ exportStage: "saving" });
        await bridge.writeBytes(root, file, new TextEncoder().encode(text));
        set({ notice: t`Exported ${file}` + left(skipped.length) });
      } finally {
        set({ exportStage: null });
      }
    },
    async exportDocx({ font, ...scope }) {
      const { dir, skipped } = await writeManuscript(
        scope,
        "manuscript.docx",
        (book, pages, assets, contents) =>
          buildDocx(book, pages, {
            assets,
            font,
            modified: new Date(),
            ...(contents ? { contents: contents.visible } : {}),
          }),
      );
      set({ notice: t`Exported ${dir}/manuscript.docx` + left(skipped.length) });
    },
    async exportRtf({ font, ...scope }) {
      const { dir, skipped } = await writeManuscript(
        scope,
        "manuscript.rtf",
        (book, pages, assets, contents) =>
          // RTF is 7-bit ASCII (everything else is a \u escape), so UTF-8 encoding is the same bytes.
          new TextEncoder().encode(
            buildRtf(book, pages, {
              assets,
              font,
              modified: new Date(),
              ...(contents ? { contents: contents.visible } : {}),
            }),
          ),
      );
      set({ notice: t`Exported ${dir}/manuscript.rtf` + left(skipped.length) });
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

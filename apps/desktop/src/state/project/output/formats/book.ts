import { isCodexFile, sourceFileById, type Manifest, type TocItem } from "@cadabracraft/format";
import { t } from "@lingui/core/macro";
import { buildEpub } from "@cadabracraft/export-epub";
import {
  bookToMarkdown,
  chapterToMarkdown,
  MarkdownExportError,
  type MarkdownOptions,
} from "@cadabracraft/export-markdown";
import { OUTLINE_FORMATS, buildOutline, serializeOutline } from "@cadabracraft/outline";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  resolveDropCap,
  hasTemplate,
} from "@cadabracraft/templates";
import { bridge } from "../../../../lib/bridge";
import { describeEpubError } from "../../../../lib/export/epubErrors";
import { indexingForExport } from "../../../../lib/indexing/pageSpecs";
import { bookContents } from "../../../../lib/export/tocExport";
import type { BookPage, ExportActions } from "../../types";
import type { Ctx } from "../../context";
import { left } from "./shared";

/** The codex only names the cast; a missing or unreadable one leaves the ids in place. */
const readCodex = (root: string) =>
  bridge
    .readFile(root, "codex.json")
    .then((r) => {
      const parsed: unknown = r ? JSON.parse(r.contents) : null;
      return isCodexFile(parsed) ? parsed.entries : [];
    })
    .catch(() => []);

/**
 * The book as Markdown. The library's error does not say where, so a failure names the first page that fails (a page with an empty
 * title is named by its file instead).
 */
function markdownOf(
  manifest: Manifest,
  meta: { title: string; author: string },
  pages: { chapters: BookPage[]; marked: BookPage[] },
  how: { opts: MarkdownOptions; contents: { items: TocItem[] } | undefined },
): string {
  try {
    return bookToMarkdown(meta, pages.marked, how.opts, how.contents);
  } catch (e) {
    if (!(e instanceof MarkdownExportError)) throw e;
    const bad = pages.chapters.find((c) => {
      try {
        chapterToMarkdown(c.doc, how.opts);
        return false;
      } catch {
        return true;
      }
    });
    const where = bad && (bad.title.trim() || sourceFileById(manifest, bad.id)!);
    throw new Error(where ? t`In “${where}”: ${e.message}` : e.message, { cause: e });
  }
}

/** The EPUB, Markdown and outline exports. */
export const createBookActions = (
  ctx: Ctx,
): Pick<ExportActions, "exportEpub" | "exportMarkdown" | "exportOutline"> => {
  const { set, get, need, flush, loadExportPages, loadAssets, loadCover } = ctx;
  return {
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
        const { pages: marked, ...generated } = indexingForExport(
          manifest,
          chapters,
          edition.language,
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
          marked,
          {
            assets,
            cover,
            ...generated,
            ...(contents ? { contents: contents.visible } : {}),
            css: template.epub.css,
            ...(manifest.sceneBreak === undefined ? {} : { sceneBreak: manifest.sceneBreak }),
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
        const { pages: marked, ...generated } = indexingForExport(
          manifest,
          chapters,
          edition.language,
        );
        const opts = {
          ...generated,
          htmlMarks,
          imageBase: "../",
          ...(manifest.sceneBreak === undefined ? {} : { sceneBreak: manifest.sceneBreak }),
        };
        const contents = bookContents(manifest, edition.language, chapters);
        const markdown = markdownOf(
          manifest,
          { title: edition.title, author: edition.author },
          { chapters, marked },
          { opts, contents: contents && { items: contents.visible } },
        );
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
        const codex = await readCodex(root);
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
  };
};

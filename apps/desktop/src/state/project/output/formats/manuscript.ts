import { sourceFileById } from "@cadabracraft/format";
import type { GlossaryPageSpec, IndexPageSpec, SceneBreakOrnamentId } from "@cadabracraft/shared";
import { t } from "@lingui/core/macro";
import { buildDocx } from "@cadabracraft/export-docx";
import { buildRtf } from "@cadabracraft/export-rtf";
import { bridge } from "../../../../lib/bridge";
import { indexingForExport } from "../../../../lib/indexing/pageSpecs";
import { bookContents } from "../../../../lib/export/tocExport";
import type { ExportActions, ExportScope } from "../../types";
import type { Ctx } from "../../context";
import { left } from "./shared";

/** What a manuscript is built from besides the book's title, author and language. */
interface ManuscriptInput {
  pages: Parameters<typeof buildDocx>[1];
  assets: Map<string, Uint8Array>;
  contents: ReturnType<typeof bookContents>;
  sceneBreak: SceneBreakOrnamentId | undefined;
  /** The index and glossary pages, only the ones the author switched on. */
  generated: { index?: IndexPageSpec; glossary?: GlossaryPageSpec };
}

/** The Word and Rich Text manuscripts. */
export const createManuscriptActions = (
  ctx: Ctx,
): Pick<ExportActions, "exportDocx" | "exportRtf"> => {
  const { set, get, need, flush, loadExportPages, loadAssets } = ctx;
  /** Loads the pages and images, runs `build` and writes `exports/<language>/<file>`; shared by the Word and Rich Text manuscripts. */
  const writeManuscript = async (
    scope: ExportScope,
    file: string,
    build: (
      book: { title: string; author: string; language: string },
      input: ManuscriptInput,
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
      const { pages: marked, ...generated } = indexingForExport(
        manifest,
        chapters,
        edition.language,
      );
      const pages = marked.map((c) => ({ ...c, id: sourceFileById(manifest, c.id)! }));
      const bytes = build(
        { title: edition.title, author: edition.author, language: edition.language },
        { pages, assets, contents, sceneBreak: manifest.sceneBreak, generated },
      );
      set({ exportStage: "saving" });
      await bridge.writeBytes(root, `${dir}/${file}`, bytes);
      return { dir, skipped };
    } finally {
      set({ exportStage: null });
    }
  };
  return {
    async exportDocx({ font, ...scope }) {
      const { dir, skipped } = await writeManuscript(
        scope,
        "manuscript.docx",
        (book, { pages, assets, contents, sceneBreak, generated }) =>
          buildDocx(book, pages, {
            assets,
            font,
            sceneBreak,
            modified: new Date(),
            ...generated,
            ...(contents ? { contents: contents.visible } : {}),
          }),
      );
      set({ notice: t`Exported ${dir}/manuscript.docx` + left(skipped.length) });
    },
    async exportRtf({ font, ...scope }) {
      const { dir, skipped } = await writeManuscript(
        scope,
        "manuscript.rtf",
        (book, { pages, assets, contents, sceneBreak, generated }) =>
          // RTF is 7-bit ASCII (everything else is a \u escape), so UTF-8 encoding is the same bytes.
          new TextEncoder().encode(
            buildRtf(book, pages, {
              assets,
              font,
              sceneBreak,
              modified: new Date(),
              ...generated,
              ...(contents ? { contents: contents.visible } : {}),
            }),
          ),
      );
      set({ notice: t`Exported ${dir}/manuscript.rtf` + left(skipped.length) });
    },
  };
};

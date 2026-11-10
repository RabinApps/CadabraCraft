import { sourceEdition } from "@cadabracraft/format";
import {
  DEFAULT_TEMPLATE_ID,
  hasTemplate,
  resolveBookFonts,
  resolveTrimSize,
} from "@cadabracraft/templates";
import { indexingForExport } from "../../../lib/indexing/pageSpecs";
import { bookContents, pdfToc } from "../../../lib/export/tocExport";
import type { Ctx } from "../context";

/**
 * Reads the book as Typst should see it right now, for the runs that do not write a PDF (the page measure and the print preview): the
 * open page's draft stands in for its saved file, so what is on screen is what is typeset. The export itself flushes and reads files.
 */
export const createTypstBook = (ctx: Ctx) => {
  const { get, need, loadExportPages, loadChaptersIn, loadAssets } = ctx;
  /** The whole book, or with `only` just that page (a measure of one chapter does not read the rest). */
  return async (only?: string) => {
    const { manifest } = need();
    const currentId = get().currentId;
    const templateId = hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID;
    const source = sourceEdition(manifest.editions).language;
    const { edition, pages } =
      only === undefined
        ? await loadExportPages()
        : {
            edition: manifest.editions.find((e) => e.language === source)!,
            pages: await loadChaptersIn(source, only),
          };
    const open = get().draft ?? get().currentDoc;
    const withOpen =
      open && currentId && (get().activeLanguage ?? source) === source
        ? pages.map((p) => (p.id === currentId ? { ...p, doc: open } : p))
        : pages;
    // The index and glossary pages count in the book's pages (a measure of one page leaves them out).
    const { pages: chapters, ...generated } =
      only === undefined
        ? indexingForExport(manifest, withOpen, edition.language)
        : { pages: withOpen };
    return {
      generated,
      templateId,
      edition,
      chapters,
      // The contents list the page of kind "contents" shows (a measure of one page leaves it out).
      toc:
        only === undefined ? pdfToc(bookContents(manifest, edition.language, chapters)) : undefined,
      trimSize: resolveTrimSize(manifest),
      ...(manifest.sceneBreak === undefined ? {} : { sceneBreak: manifest.sceneBreak }),
      fonts: resolveBookFonts(manifest),
      assets: () => loadAssets(chapters),
    };
  };
};

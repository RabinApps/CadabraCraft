import { sourceEdition } from "@cadabracraft/format";
import {
  DEFAULT_TEMPLATE_ID,
  hasTemplate,
  resolveBookFonts,
  resolveTrimSize,
} from "@cadabracraft/templates";
import type { Ctx } from "./context";

/**
 * Reads the book as Typst should see it right now, for the runs that do not write a PDF (the page measure and the print preview): the
 * open page's draft stands in for its saved file, so what is on screen is what is typeset. The export itself flushes and reads files.
 */
export const createTypstBook = (ctx: Ctx) => {
  const { get, need, loadExportPages, loadAssets } = ctx;
  return async () => {
    const { manifest } = need();
    const currentId = get().currentId;
    const templateId = hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID;
    const { edition, pages } = await loadExportPages();
    const open = get().draft ?? get().currentDoc;
    const source = sourceEdition(manifest.editions).language;
    const chapters =
      open && currentId && (get().activeLanguage ?? source) === source
        ? pages.map((p) => (p.id === currentId ? { ...p, doc: open } : p))
        : pages;
    return {
      templateId,
      edition,
      chapters,
      trimSize: resolveTrimSize(manifest),
      fonts: resolveBookFonts(manifest),
      assets: () => loadAssets(chapters),
    };
  };
};

import { contentHash } from "@cadabracraft/export-audio";
import { measurePages, type PageReport } from "@cadabracraft/export-pdf";
import { getTemplate } from "@cadabracraft/templates";
import { bridge } from "../../../../lib/bridge";
import { describePdfError } from "../../../../lib/export/pdfErrors";
import { createTauriRunner } from "../../../../lib/export/typstRunner";
import type { createTypstBook } from "../typstBook";

/** Typst's page reports: one run per distinct content however many callers ask. */
export const createMeasure = (gather: ReturnType<typeof createTypstBook>) => {
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
      JSON.stringify([
        templateId,
        trimSize,
        fonts,
        edition.title,
        edition.language,
        chapters,
        toc,
        book.generated,
      ]),
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
          ...book.generated,
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
  return { measureBook, measure };
};

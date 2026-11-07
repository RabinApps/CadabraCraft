import type { ExportActions } from "../types";
import type { Ctx } from "../context";
import { createContentsPreviewActions } from "./contentsPreview";
import { createMeasure } from "./formats/measure";
import { createPreviewActions } from "./preview";
import { createTypstBook } from "./typstBook";

/**
 * The one-shot exporters (EPUB, Markdown, outline, Word, Rich Text, print PDF) are loaded the first time one runs, so their
 * libraries stay out of the startup bundle. Each wrapper builds the real actions once and then delegates.
 */
const lazyActions = <K extends keyof ExportActions>(
  load: () => Promise<Pick<ExportActions, K>>,
  names: readonly K[],
): Pick<ExportActions, K> => {
  let loaded: Promise<Pick<ExportActions, K>> | undefined;
  const actions = {} as Record<K, (...args: never[]) => Promise<void>>;
  for (const name of names) {
    actions[name] = async (...args: never[]) => {
      loaded ??= load();
      const real = (await loaded)[name] as unknown as (...a: never[]) => Promise<void>;
      return real(...args);
    };
  }
  return actions as unknown as Pick<ExportActions, K>;
};

/** The one-shot exports: EPUB, Markdown, Word, Rich Text and the print PDF. */
export const createExportActions = (ctx: Ctx): ExportActions => {
  const gather = createTypstBook(ctx);
  const { measureBook, measure } = createMeasure(gather);
  return {
    ...createPreviewActions(ctx, gather),
    ...createContentsPreviewActions(ctx, gather, (book) => measureBook(book, "book-plain", false)),
    measurePages: (options) => measure(undefined, options?.marks ?? false),
    measureChapter: (id) => measure(id),
    ...lazyActions(
      async () => (await import("./formats/book")).createBookActions(ctx),
      ["exportEpub", "exportMarkdown", "exportOutline"],
    ),
    ...lazyActions(
      async () => (await import("./formats/manuscript")).createManuscriptActions(ctx),
      ["exportDocx", "exportRtf"],
    ),
    ...lazyActions(
      async () => (await import("./formats/pdf")).createPdfActions(ctx),
      ["exportPdf"],
    ),
  };
};

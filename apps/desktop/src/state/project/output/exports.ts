import type { ExportActions } from "../types";
import type { Ctx } from "../context";
import { createContentsPreviewActions } from "./contentsPreview";
import { createBookActions } from "./formats/book";
import { createManuscriptActions } from "./formats/manuscript";
import { createMeasure } from "./formats/measure";
import { createPdfActions } from "./formats/pdf";
import { createPreviewActions } from "./preview";
import { createTypstBook } from "./typstBook";

/** The one-shot exports: EPUB, Markdown, Word, Rich Text and the print PDF. */
export const createExportActions = (ctx: Ctx): ExportActions => {
  const gather = createTypstBook(ctx);
  const { measureBook, measure } = createMeasure(gather);
  return {
    ...createPreviewActions(ctx, gather),
    ...createContentsPreviewActions(ctx, gather, (book) => measureBook(book, "book-plain", false)),
    measurePages: (options) => measure(undefined, options?.marks ?? false),
    measureChapter: (id) => measure(id),
    ...createBookActions(ctx),
    ...createManuscriptActions(ctx),
    ...createPdfActions(ctx),
  };
};

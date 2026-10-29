import { PdfExportError, TypstCompileError } from "./errors";
import { prepareDocument } from "./prepare";
import type { RenderPdfOptions } from "./render";
import type { TypstRunner } from "./runner";
import type { PdfBook, PdfChapter } from "./types";
import { errMsg } from "@cadabracraft/shared";

/** Where one page entry (chapter or front/back matter page) starts in the laid-out book. */
export interface PageStart {
  /** The `PdfChapter.id` of the entry. */
  id: string;
  /** "chapter" or the matter kind. */
  kind: string;
  /** Physical page (1-based) the entry starts on. */
  page: number;
  /** Physical page the entry ends on (its last page; a blank verso before the next entry is not part of it). */
  end: number;
  /** The page number printed there ("iii", "7"), or "" when the page shows none. */
  number: string;
}

export interface PageReport {
  /** Physical page count of the book. */
  total: number;
  /** One per page entry, in reading order. */
  starts: PageStart[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function bad(why: string): never {
  throw new PdfExportError(`Unexpected page report from Typst: ${why}`);
}

/** Parse and validate the JSON text of the `<page-report>` value. Throws `PdfExportError` on any other shape. */
export function parsePageReport(json: string): PageReport {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return bad("not JSON");
  }
  if (!isRecord(raw) || !isCount(raw.total) || !Array.isArray(raw.starts))
    return bad("expected { total, starts }");
  const starts = raw.starts.map((s: unknown, i): PageStart => {
    if (
      !isRecord(s) ||
      typeof s.id !== "string" ||
      typeof s.kind !== "string" ||
      !isCount(s.page) ||
      !isCount(s.end) ||
      s.end < s.page ||
      typeof s.number !== "string"
    )
      return bad(`starts[${i}] needs id, kind, page, end and number`);
    return { id: s.id, kind: s.kind, page: s.page, end: s.end, number: s.number };
  });
  return { total: raw.total, starts };
}

/**
 * Measure a book's pages with Typst without producing a PDF: physical page count and where each entry starts, with the
 * printed page number. Takes the same arguments as `renderPdf` (same fonts, same assets, same errors for missing ones).
 */
export async function measurePages(
  book: PdfBook,
  chapters: PdfChapter[],
  options: RenderPdfOptions,
  runner: TypstRunner,
): Promise<PageReport> {
  const { source, files } = await prepareDocument(book, chapters, options, runner);
  let json: string;
  try {
    json = await runner.query(source, files, "<page-report>");
  } catch (e) {
    throw e instanceof PdfExportError ? e : new TypstCompileError(errMsg(e));
  }
  return parsePageReport(json);
}

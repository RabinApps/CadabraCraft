import { PdfExportError, TypstCompileError } from "./errors";
import { prepareDocument } from "./prepare";
import type { RenderPdfOptions } from "./render";
import type { TypstRunner } from "./runner";
import type { PdfBook, PdfChapter } from "./types";
import type { BlockMarkKind } from "./typst/blocks";
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

/** Where one top-level block of a chapter landed (from `PdfOptions.blockMarks`). */
export interface BlockPages {
  /** Index of the block among the chapter's top-level nodes. */
  block: number;
  /** What the block is: `p` an ordinary paragraph (words marked), `q` another paragraph (also the drop cap paragraph), `h` heading, `s` scene break, `o` anything else. */
  kind: BlockMarkKind;
  /** Physical page its first line is on. */
  page: number;
  /**
   * Ordinary paragraphs only: the word (index in `wordStarts`) that begins each later page the block runs onto, with that page. A
   * block's last page is the last of these, else `page`; for any other kind of block the report cannot say whether it runs onto the
   * next page (an end mark would be moved to the next page when the block ends at the foot of one).
   */
  splits: { word: number; page: number }[];
}

export interface PageReport {
  /** Physical page count of the book. */
  total: number;
  /** One per page entry, in reading order. */
  starts: PageStart[];
  /** With `blockMarks`: the blocks of each chapter (by entry id) in document order. Empty blocks (no text) have no entry. */
  blocks?: Record<string, BlockPages[]>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isKind = (v: unknown): v is BlockMarkKind =>
  v === "p" || v === "q" || v === "h" || v === "s" || v === "o";
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
  const blocks = parseMarks(raw.marks, starts);
  return { total: raw.total, starts, ...(blocks ? { blocks } : {}) };
}

/** The `marks` tuples as blocks per entry id; undefined when there are none or they do not form complete blocks (then the report says nothing about breaks inside chapters). */
function parseMarks(marks: unknown, starts: PageStart[]): Record<string, BlockPages[]> | undefined {
  if (!Array.isArray(marks) || marks.length === 0) return undefined;
  const out: Record<string, BlockPages[]> = {};
  let open: BlockPages | undefined;
  for (const m of marks as unknown[]) {
    if (!Array.isArray(m)) return undefined;
    const [kind, a, b, c, d] = m as unknown[];
    if (kind === "s") {
      const entry = isCount(a) ? starts[a] : undefined;
      if (!entry || !isCount(b) || !isKind(c) || !isCount(d)) return undefined;
      open = { block: b, kind: c, page: d, splits: [] };
      (out[entry.id] ??= []).push(open);
    } else if (kind === "w") {
      if (!open || !isCount(a) || !isCount(b)) return undefined;
      // Typst puts a mark that sits where a line breaks on the line before the break, so the first mark on a new page is the one
      // before the page's second word: the page begins one word earlier.
      if (a < 1) return undefined;
      open.splits.push({ word: a - 1, page: b });
    } else return undefined;
  }
  return out;
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

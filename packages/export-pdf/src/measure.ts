import { PdfExportError, TypstCompileError } from "./errors";
import { prepareDocument } from "./prepare";
import type { RenderPdfOptions } from "./render";
import type { TypstRunner } from "./runner";
import type { CharMark, PdfBook, PdfChapter } from "./types";
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

/**
 * Where one leaf of a chapter landed (from `PdfOptions.blockMarks`): a paragraph, heading, scene break, image or block of code. A quote,
 * list or table is several leaves of one top-level block.
 */
export interface BlockPages {
  /** Index of the top-level block among the chapter's nodes. */
  block: number;
  /** Index among the leaves of that block that the report has (a blank paragraph, which the exporter skips, has none); 0 for a block that is one leaf. */
  leaf: number;
  /** What the leaf is: `p` a paragraph (words marked), `h` heading, `s` scene break, `i` image, `k` block of code (lines marked). */
  kind: BlockMarkKind;
  /** Physical page its first line is on. */
  page: number;
  /**
   * Text and code: the word (index in `wordStarts`; the line, counted from 0, for code) that begins each later page the leaf runs onto,
   * with that page. A leaf's last page is the last of these, else `page`; a scene break and an image never run onto another page. There
   * is no end mark that could say more (it would be moved to the next page when the leaf ends at the foot of one). `char`: Typst
   * hyphenated the word (or broke it after a hyphen) at the page break, and the page begins this many characters (UTF-16 units)
   * into it; absent when it begins at the word's first character.
   */
  splits: { word: number; page: number; char?: number }[];
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
  v === "p" || v === "h" || v === "s" || v === "i" || v === "k";
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
      const list = (out[entry.id] ??= []);
      const last = list[list.length - 1];
      open = {
        block: b,
        leaf: last?.block === b ? last.leaf + 1 : 0,
        kind: c,
        page: d,
        splits: [],
      };
      list.push(open);
    } else if (kind === "w" || kind === "l") {
      if (!open || !isCount(a) || !isCount(b)) return undefined;
      // Typst puts a mark that sits where a line breaks on the line before the break, so the first mark on a new page is the one
      // before the page's second word (second line, counting a line mark from 1): the page begins one word earlier.
      const word = kind === "w" ? a - 1 : a - 2;
      if (word < 0) return undefined;
      open.splits.push({ word, page: b });
    } else return undefined;
  }
  return out;
}

/** The characters the second run marked: `chapter:block:leaf:word` to the first char mark on each page, by page. Undefined when the marks are not tuples of counts. */
function parseChars(marks: unknown): Map<string, Map<number, number>> | undefined {
  const out = new Map<string, Map<number, number>>();
  if (!Array.isArray(marks)) return out;
  for (const m of marks as unknown[]) {
    if (!Array.isArray(m)) return undefined;
    if (m[0] !== "c") continue;
    const [, chapter, block, leaf, word, char, page] = m as unknown[];
    if (![chapter, block, leaf, word, char, page].every(isCount)) return undefined;
    const key = `${chapter}:${block}:${leaf}:${word}`;
    const pages = out.get(key) ?? new Map<number, number>();
    if (!pages.has(page as number)) pages.set(page as number, char as number);
    out.set(key, pages);
  }
  return out;
}

/**
 * Where inside its word each page that begins in a word begins. The marks of the first run sit between words, and Typst puts a mark
 * at a line break on the line before it, so a page that begins in the middle of a word (hyphenated, or broken after a hyphen) looks
 * the same there as one that begins at the word. The second run marks every character boundary of just those words (no word marks,
 * so it costs about what the book does without marks) and the first mark on the page's page says where the line broke. The run is
 * only trusted when the book came out the same length with every chapter on the same pages; otherwise, or when it fails, the
 * report keeps the words.
 */
async function refine(
  book: PdfBook,
  chapters: PdfChapter[],
  options: RenderPdfOptions,
  runner: TypstRunner,
  first: PageReport,
): Promise<PageReport> {
  const wanted: CharMark[] = [];
  first.starts.forEach((entry, chapter) => {
    for (const u of first.blocks?.[entry.id] ?? [])
      if (u.kind === "p" || u.kind === "h")
        for (const s of u.splits)
          wanted.push({ chapter, block: u.block, leaf: u.leaf, word: s.word });
  });
  if (wanted.length === 0) return first;
  let chars: Map<string, Map<number, number>> | undefined;
  try {
    const { source, files } = await prepareDocument(
      book,
      chapters,
      { ...options, charMarks: wanted },
      runner,
    );
    const json = await runner.query(source, files, "<page-report>");
    const second = parsePageReport(json);
    const same =
      second.total === first.total &&
      second.starts.length === first.starts.length &&
      second.starts.every(
        (s, i) => s.page === first.starts[i]?.page && s.end === first.starts[i]?.end,
      );
    if (same) chars = parseChars((JSON.parse(json) as { marks?: unknown }).marks);
  } catch {
    /* The words are what the report has. */
  }
  if (!chars) return first;
  first.starts.forEach((entry, chapter) => {
    for (const u of first.blocks?.[entry.id] ?? [])
      for (const s of u.splits) {
        const at = chars.get(`${chapter}:${u.block}:${u.leaf}:${s.word}`)?.get(s.page);
        // The mark between the word's first and second character (1) on the new page is no break inside the word; the page begins
        // one character before the first mark on it (the line break puts the mark there on the line before).
        if (at !== undefined && at >= 2) s.char = at - 1;
      }
  });
  return first;
}

/**
 * Measure a book's pages with Typst without producing a PDF: physical page count and where each entry starts, with the
 * printed page number. Takes the same arguments as `renderPdf` (same fonts, same assets, same errors for missing ones). With
 * `blockMarks` the report also says where the pages break inside each chapter, down to the character where Typst hyphenated a word.
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
  const report = parsePageReport(json);
  return options.blockMarks ? refine(book, chapters, options, runner, report) : report;
}

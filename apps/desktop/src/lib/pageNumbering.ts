import { TRIM_SIZES, type PageReport, type TrimSize } from "@cadabracraft/export-pdf";
import {
  layoutBook,
  type BookPages,
  type EntryKind,
  type PageEntryInput,
  type Section,
} from "@cadabracraft/shared";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  hasTemplate,
  resolveTrimSize,
  resolveVerticalCenter,
} from "@cadabracraft/templates";
import { wordsPerPage } from "./printEstimate";
import { usableReport } from "./pageReport";

type BookLike = { template: string; trimSize?: TrimSize };

const printOf = (template: string) =>
  getTemplate(hasTemplate(template) ? template : DEFAULT_TEMPLATE_ID).print;

/** Where the template starts a chapter: on a right-hand page, or on the next page. */
export const chapterStart = (book: BookLike): "recto" | "any" =>
  printOf(book.template).chapterOpening.startOn;

/** Words per page for a book's template and trim size. */
export const bookWordsPerPage = (book: BookLike): number =>
  wordsPerPage(
    TRIM_SIZES[resolveTrimSize(book)],
    printOf(book.template).defaults.marginsIn,
    printOf(book.template).fontSizePt,
  );

/** Pages one entry takes from its words: `ceil(words / words per page)`, at least one. */
export const chapterPageCount = (words: number, perPage: number): number =>
  Math.max(1, Math.ceil(words / perPage));

/** One page of the book as the layout needs it. */
export interface EntryWords {
  id: string;
  section: Section;
  kind?: EntryKind | undefined;
  /** The author's own vertical position choice for a matter page. */
  verticalCenter?: boolean | undefined;
  /** The author's start for a matter page: the next page, left-hand page or not (no blank page before it), or a right-hand page (a blank page before it when needed). */
  startOnNext?: boolean | undefined;
  words: number;
}

/** What is known about the book's real page counts, best first: Typst's report, then what an editor measured, else the words. */
export interface PageSources {
  /** Typst's page report of the book (a stale one is fine: it is only the page counts and, while `fresh`, the starts). */
  report?: PageReport | null;
  /** The report is of the text as it is now: every entry starts where it says. */
  fresh?: boolean;
  /** Pages an editor laid out for an entry (a blank page before it not counted), by id. Newer than a stale report. */
  measured?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /** The book prints page numbers (the PDF export's switch). */
  numbered?: boolean;
}

const measuredOf = (m: PageSources["measured"], id: string): number | undefined =>
  m instanceof Map ? m.get(id) : (m as Record<string, number> | undefined)?.[id];

/**
 * The page layout of the whole book: where every entry starts and what number is printed there (see `layoutBook`, which holds the
 * rules). Each entry's page count is the first that applies: Typst's, when its report is current; an editor's measure of the
 * entry; Typst's from an older report; the estimate from its words. A current report that has every entry also gives the starts,
 * so the layout can never disagree with the PDF; otherwise they follow from the counts.
 */
export function bookLayout(
  book: BookLike,
  entries: readonly EntryWords[],
  sources: PageSources = {},
): BookPages {
  const print = printOf(book.template);
  const perPage = bookWordsPerPage(book);
  const report = usableReport(sources.report ?? null);
  const starts = new Map(report?.starts.map((s) => [s.id, s]));
  const current = sources.fresh === true && entries.every((e) => starts.has(e.id));
  const inputs: PageEntryInput[] = entries.map((e) => {
    const s = starts.get(e.id);
    const own = measuredOf(sources.measured, e.id);
    const reported = s ? s.end - s.page + 1 : undefined;
    const fresh = sources.fresh === true ? reported : undefined;
    const pages = Math.max(1, fresh ?? own ?? reported ?? chapterPageCount(e.words, perPage));
    return {
      id: e.id,
      section: e.section,
      kind: e.kind,
      pages,
      exact: fresh !== undefined || own !== undefined,
      centred:
        e.kind === "part" ||
        (e.section !== "chapter" &&
          resolveVerticalCenter({ print }, e.kind, { verticalCenter: e.verticalCenter })),
      ...(e.startOnNext === undefined ? {} : { startOnNext: e.startOnNext }),
      ...(current && s ? { start: s.page } : {}),
    };
  });
  return layoutBook(inputs, {
    startsOn: print.chapterOpening.startOn,
    ...(sources.numbered === false ? { numbered: false } : {}),
    // A current report's total is the PDF's own page count, blank pages after the last entry included.
    ...(current && report ? { total: report.total } : {}),
  });
}

import {
  attachPages,
  outlineKeys,
  type EditionEntry,
  type Outlines,
  type StaleOverride,
  type TocItem,
  type TocPageStart,
  type TocSettings,
  tocSettingsOf,
} from "@cadabracraft/format";
import type { PageReport, PageStart } from "@cadabracraft/export-pdf";
import { firstPageNumber } from "./pageNumbering";

/** The page number to show for one list row: `text` is null when nothing is known (shown as a dash), `estimated` when it comes from the word-count estimate. */
export interface TocRow {
  item: TocItem;
  text: string | null;
  estimated: boolean;
}

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

export const toRoman = (n: number): string => {
  let rest = n;
  let out = "";
  for (const [value, text] of ROMAN)
    while (rest >= value) {
      out += text;
      rest -= value;
    }
  return out;
};

const fromRoman = (text: string): number | null => {
  if (!/^[ivxlcdm]+$/.test(text)) return null;
  let rest = text;
  let n = 0;
  for (const [value, part] of ROMAN)
    while (rest.startsWith(part)) {
      n += value;
      rest = rest.slice(part.length);
    }
  return toRoman(n) === text ? n : null;
};

/** The number printed on physical page `page` of an entry that starts on `start.page` with number `start.number` ("7", "iii"); null when it cannot be told. */
export function printedNumber(
  start: Pick<PageStart, "page" | "number">,
  page: number,
): string | null {
  const offset = page - start.page;
  if (offset < 0) return null;
  if (/^\d+$/.test(start.number)) return String(Number(start.number) + offset);
  const roman = fromRoman(start.number);
  return roman === null ? null : toRoman(roman + offset);
}

/**
 * Page numbers of the headings in a report made with page marks. A chapter's headings are its `h` marks in document order; they
 * are used only when there are as many as the outline has (otherwise the text moved since the measure and the marks cannot be
 * trusted). Keys are the contents item keys.
 */
export function headingPageNumbers(report: PageReport, outlines: Outlines): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, outline] of Object.entries(outlines)) {
    const start = report.starts.find((s) => s.id === id);
    const marks = (report.blocks?.[id] ?? []).filter((b) => b.kind === "h");
    if (!start || marks.length !== outline.length) continue;
    const keys = outlineKeys(id, outline);
    marks.forEach((mark, i) => {
      const number = printedNumber(start, mark.page);
      if (number !== null) out[keys[i]!] = number;
    });
  }
  return out;
}

export interface TocPageSource {
  /** The book's page report (Typst's own numbers), when there is a current one. */
  report: PageReport | null;
  /** The report is of the text as it is now. A report the book has moved on from still shows its numbers, marked as estimates. */
  current: boolean;
  /** Fallback: the estimated first page of each chapter (entry id to number), used for every entry the report does not cover. */
  estimates: Readonly<Record<string, number>>;
  outlines: Outlines;
}

/**
 * The rows of the contents editor with their page numbers. Precedence: Typst's report (exact), then the estimate for chapters
 * (marked `estimated`), else no number. Headings take theirs from the report's marks only. A custom entry shows its target's number.
 */
export function tocRows(items: readonly TocItem[], source: TocPageSource): TocRow[] {
  const { report } = source;
  const reported: TocPageStart[] = report
    ? report.starts.map((s) => ({ id: s.id, number: s.number }))
    : [];
  const known = new Set(reported.filter((s) => s.number !== "").map((s) => s.id));
  const guessed: TocPageStart[] = Object.entries(source.estimates)
    .filter(([id]) => !known.has(id))
    .map(([id, n]) => ({ id, number: String(n) }));
  const heading = report ? headingPageNumbers(report, source.outlines) : {};
  const estimatedIds = new Set(guessed.map((s) => s.id));
  return attachPages(items, [...reported, ...guessed], heading).map((item, i) => {
    const original = items[i]!;
    const ref = original.kind === "custom" ? original.target : original.key;
    return {
      item,
      text: item.page ?? null,
      estimated:
        item.page !== undefined &&
        (!source.current || (ref !== undefined && estimatedIds.has(ref))),
    };
  });
}

/** What a stale override was for, to show the author: their own text, else the readable part of its key. */
export function staleLabel(entry: EditionEntry, key: string, language: string): string {
  const settings = tocSettingsOf(entry);
  const custom = settings.custom.find((c) => `custom:${c.id}` === key);
  const own = settings.titles[key]?.[language] ?? Object.values(settings.titles[key] ?? {})[0];
  if (custom) return custom.titles[language] ?? Object.values(custom.titles)[0]!;
  if (own !== undefined) return own;
  const heading = /^[^#]*#\d+:(.*):\d+$/.exec(key);
  return heading ? heading[1]! : key;
}

/** The stale overrides grouped by key, in first-seen order (one row per key however many overrides it has). Custom entries are shown in the list itself, so they are left out. */
export function staleKeys(stale: readonly StaleOverride[]): string[] {
  return [...new Set(stale.filter((s) => s.kind !== "custom").map((s) => s.key))];
}

/** Insertion point under a pointer (see `insertionIndex` in `referenceKinds`): kept here for the contents list, which drops onto item positions. */
export { insertionIndex, dropPosition } from "./referenceKinds";

/**
 * The estimated first page of each chapter (entry id to number), from the chapters' word counts: `words[i]` belongs to
 * `chapterIds[i]`. Front and back matter have no estimate (they are not part of the chapter count).
 */
export function estimateStarts(
  book: Parameters<typeof firstPageNumber>[0],
  chapterIds: readonly string[],
  words: readonly number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  chapterIds.forEach((id, i) => {
    if (i < words.length) out[id] = firstPageNumber(book, words.slice(0, i));
  });
  return out;
}

/** True when the list or an override mentions a heading, so the pages' headings must be read (a list of pages alone needs no file). */
export function needsOutlines(settings: TocSettings): boolean {
  const heading = (key: string) => key.includes("#");
  return (
    settings.depth > 0 ||
    settings.hidden.some(heading) ||
    Object.keys(settings.titles).some(heading) ||
    (settings.order ?? []).some(heading) ||
    settings.custom.some((c) => heading(c.after) || (c.target !== undefined && heading(c.target)))
  );
}

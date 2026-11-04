/**
 * The one place that says which page of the printed book every entry starts on and what number is printed there. Pure: the book's
 * reading order, the template's chapter opening and each entry's page count (measured by Typst when known, estimated otherwise)
 * go in; for every entry its physical first page, whether a blank left-hand page precedes it, and its numbering come out.
 * Every surface (Write and Read page cards, the status bar, the Contents estimate, the print preview) asks this and nothing else.
 *
 * The rules are those of the Typst document the PDF is made from (`packages/export-pdf/src/typst/matter.ts`, see
 * `pagenumbers.render.test.ts`):
 * - Front matter is numbered in lowercase roman by physical page (the title, copyright and contents pages show no number).
 * - The first page after the front matter opens on a right-hand page and restarts the count at arabic 1; every later page (back
 *   matter and blank pages included) continues it. A book without front matter is arabic from its first page.
 * - Title page, contents, dedication and epigraph open on a right-hand page, and the entry after a dedication or epigraph does too.
 *   A chapter, and a front or back matter page that is not laid out centred, opens like the template's chapter opening says
 *   (`startsOn`): "recto" puts a blank left-hand page first when the next page would be even. Every other entry starts on the next page.
 * - A front or back matter page can say how it starts (`startOnNext`, the author's choice): on the next page, with no blank page
 *   before it whatever the rules above say (`true`), or on a right-hand page, with a blank left-hand page before it when the next
 *   page would be a left-hand one (`false`). A page that also restarts the arabic count keeps `true` and the count starts at 1
 *   there, even when that puts the first numbered page on a left-hand page.
 */
import type { MatterKind, Section } from "./matter";

export type FolioStyle = "roman" | "arabic";

export interface PageEntryInput {
  id: string;
  section: Section;
  /** Matter kind; chapters have none. */
  kind?: MatterKind | undefined;
  /** Pages the entry fills, not counting the blank page before it. At least 1 is assumed. */
  pages: number;
  /** `pages` is Typst's count (or the editor's measured one), not an estimate from words. */
  exact: boolean;
  /** A matter page laid out in the vertical middle of the page: it does not use the chapter opening. */
  centred?: boolean | undefined;
  /**
   * The author's start for a front or back matter page: `true` is the next page, with no blank page before it even when that is a
   * left-hand page; `false` is a right-hand page, with a blank left-hand page before it when it would otherwise be even. Absent
   * follows the rules above.
   */
  startOnNext?: boolean | undefined;
  /** The physical page Typst started the entry on (1-based): used as it is, over the rules above. */
  start?: number | undefined;
}

export interface PlacedEntry {
  id: string;
  section: Section;
  kind: MatterKind | undefined;
  /** Physical page the entry's first page is on, 1-based (the cover is not counted). */
  start: number;
  /** A blank left-hand page, `start - 1`, comes first: the page stack draws it, the entry does not start there. */
  blankBefore: boolean;
  /** Physical page of the first page the page stack draws for the entry: `start`, or the blank page before it. */
  cardStart: number;
  pages: number;
  /** Physical page of its last page. */
  end: number;
  exact: boolean;
  /**
   * `start` is the real one: Typst placed it, or every entry up to this one has a measured count. When it is false the entry's
   * first page number may still move by a page until the entries before it are measured, so a surface marks it with "≈".
   */
  startExact: boolean;
  /** Numbering of its first page. */
  style: FolioStyle;
  /** The number printed on its first page, or null when that page shows none (title and copyright pages, numbers off). */
  number: number | null;
  /** `number` as printed ("iv", "12"), or "" when the page shows none. */
  folio: string;
}

export interface BookPages {
  entries: PlacedEntry[];
  byId: ReadonlyMap<string, PlacedEntry>;
  /** Pages in the whole interior, blank pages included. */
  physical: number;
  /** Physical page of arabic 1, or null when there is none (no page after the front matter). */
  arabicFrom: number | null;
  /** Front matter is numbered in roman. */
  hasFront: boolean;
  /** Pages from arabic 1 to the last page: the book's page count as a publisher gives it. */
  bodyPages: number;
  /** Every entry's count was measured. */
  exact: boolean;
  numbered: boolean;
}

const ALWAYS_RECTO: readonly (MatterKind | undefined)[] = [
  "title-page",
  "contents",
  "dedication",
  "epigraph",
];
const BLANK_VERSO_AFTER: readonly (MatterKind | undefined)[] = ["dedication", "epigraph"];
const OWN_OPENING: readonly (MatterKind | undefined)[] = [
  "title-page",
  "copyright",
  "contents",
  "dedication",
  "epigraph",
];
const NO_FOLIO: readonly (MatterKind | undefined)[] = ["title-page", "copyright", "contents"];

/** Whether the entry opens with the template's chapter opening (a chapter, or matter that is not laid out in the middle of the page). */
const usesChapterOpening = (e: PageEntryInput): boolean =>
  e.section === "chapter" || (!OWN_OPENING.includes(e.kind) && e.centred !== true);

/**
 * Places every entry of the book, in reading order. `numbered` false is a book printed without page numbers. `total` is the page
 * count the whole book really has (Typst's, when its report is current): it wins over what the entries add up to, which can be
 * short when blank pages follow the last entry.
 */
export function layoutBook(
  entries: readonly PageEntryInput[],
  opts: { startsOn: "recto" | "any"; numbered?: boolean; total?: number | undefined },
): BookPages {
  const numbered = opts.numbered ?? true;
  const hasFront = entries.some((e) => e.section === "front");
  const placed: PlacedEntry[] = [];
  let next = 1;
  let previous: MatterKind | undefined;
  let arabicFrom: number | null = hasFront ? null : 1;
  // Every count up to the entry being placed is Typst's or an editor's, so where it starts is the real page it starts on.
  let countsExact = true;
  for (const e of entries) {
    const restart = hasFront && arabicFrom === null && e.section !== "front";
    // The author's "right-hand page" wins over every rule and adds the blank page where the rules would have left it on a verso.
    const recto =
      e.startOnNext === false ||
      restart ||
      ALWAYS_RECTO.includes(e.kind) ||
      BLANK_VERSO_AFTER.includes(previous) ||
      (opts.startsOn === "recto" && usesChapterOpening(e));
    let start = next;
    if (e.start !== undefined) start = Math.max(e.start, 1);
    else if (recto && e.startOnNext !== true && start % 2 === 0) start += 1;
    if (restart) arabicFrom = start;
    const pages = Math.max(1, e.pages);
    placed.push({
      id: e.id,
      section: e.section,
      kind: e.kind,
      start,
      blankBefore: start > next,
      cardStart: start > next ? start - 1 : start,
      pages,
      end: start + pages - 1,
      exact: e.exact,
      startExact: e.start !== undefined || countsExact,
      style: arabicFrom === null || start < arabicFrom ? "roman" : "arabic",
      number: null,
      folio: "",
    });
    next = start + pages;
    previous = e.kind;
    countsExact = countsExact && e.exact;
  }
  const folio = (p: number): number =>
    arabicFrom === null || p < arabicFrom ? p : p - arabicFrom + 1;
  for (const p of placed) {
    p.number = numbered && !NO_FOLIO.includes(p.kind) ? folio(p.start) : null;
    p.folio = p.number === null ? "" : formatFolio(p.number, p.style);
  }
  const physical = opts.total !== undefined ? Math.max(opts.total, next - 1) : next - 1;
  return {
    entries: placed,
    byId: new Map(placed.map((p) => [p.id, p])),
    physical,
    arabicFrom,
    hasFront,
    bodyPages: arabicFrom === null ? 0 : physical - arabicFrom + 1,
    exact: placed.length > 0 && placed.every((p) => p.exact),
    numbered,
  };
}

const ROMAN: readonly [number, string][] = [
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

/** `n` as printed: lowercase roman ("iv") or arabic ("4"). Roman has no zero or negative: those print as arabic. */
export function formatFolio(n: number, style: FolioStyle): string {
  if (style === "arabic" || n < 1) return String(n);
  let rest = n;
  let out = "";
  for (const [value, glyph] of ROMAN)
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  return out;
}

/** The number and style of physical page `page` (a blank left-hand page included), whatever entry it belongs to. */
export function folioAt(book: BookPages, page: number): { style: FolioStyle; number: number } {
  const arabic = book.arabicFrom !== null && page >= book.arabicFrom;
  return arabic
    ? { style: "arabic", number: page - book.arabicFrom! + 1 }
    : { style: "roman", number: page };
}

/** The printed text of physical page `page`: "" when the book has no page numbers or the page is one of the title, copyright and contents pages. */
export function folioText(book: BookPages, page: number): string {
  if (!book.numbered) return "";
  const own = book.entries.find((e) => e.start <= page && page <= e.end);
  if (own && own.number === null) return "";
  const f = folioAt(book, page);
  return formatFolio(f.number, f.style);
}

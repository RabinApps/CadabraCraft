import type { Edition } from "@cadabracraft/format";
import { fuzzyMatch } from "../../lib/fuzzy";
import type { BookStats, Recent } from "../../state/recents";

/** What the Library caches about a book from its source edition (cover file, series text and number). Absent fields stay absent. */
export function libraryFields(
  edition: Pick<Edition, "cover" | "publishing">,
): Pick<BookStats, "cover" | "series" | "seriesNumber"> {
  const series = edition.publishing?.series;
  const number = edition.publishing?.seriesNumber;
  return {
    ...(edition.cover ? { cover: edition.cover } : {}),
    ...(series ? { series } : {}),
    ...(series && number ? { seriesNumber: number } : {}),
  };
}

export type LibrarySort = "edited" | "title" | "author" | "words" | "series";
export const SORTS: readonly LibrarySort[] = ["edited", "title", "author", "words", "series"];

/** What one row of the Library shows, whether the book was opened (stats) or only scanned. */
export interface BookInfo {
  author: string;
  words: number | null;
  chapters: number | null;
  cover: string | undefined;
  series: string | undefined;
  seriesNumber: string | undefined;
  editedAt: number;
}

export function infoOf(r: Recent): BookInfo {
  const src = r.stats ?? r.scanned;
  return {
    author: src?.author ?? "",
    words: r.stats?.words ?? null,
    chapters: r.stats?.chapters ?? null,
    cover: src?.cover,
    series: src?.series,
    seriesNumber: src?.seriesNumber,
    editedAt: r.editedAt ?? r.openedAt,
  };
}

const collator = (locale: string) =>
  new Intl.Collator(locale, { numeric: true, sensitivity: "base" });

const numberOf = (n: string | undefined) =>
  n === undefined ? Number.POSITIVE_INFINITY : Number(n);

/** Orders a copy of the list. Equal keys fall back to the title, so the order is stable between renders. */
export function sortBooks(list: readonly Recent[], sort: LibrarySort, locale: string): Recent[] {
  const cmp = collator(locale).compare;
  const key = (a: Recent, b: Recent): number => {
    const [x, y] = [infoOf(a), infoOf(b)];
    switch (sort) {
      case "edited":
        return y.editedAt - x.editedAt;
      case "title":
        return 0;
      case "author":
        // Books without an author go last.
        return x.author === "" || y.author === ""
          ? Number(x.author === "") - Number(y.author === "")
          : cmp(x.author, y.author);
      case "words":
        return (y.words ?? -1) - (x.words ?? -1);
      case "series":
        return x.series === undefined || y.series === undefined
          ? Number(x.series === undefined) - Number(y.series === undefined)
          : cmp(x.series, y.series) || numberOf(x.seriesNumber) - numberOf(y.seriesNumber);
    }
  };
  return [...list].sort((a, b) => key(a, b) || cmp(a.title, b.title));
}

/** Keeps the books whose title, author or series contains the query's letters in order (the palette's fuzzy match). */
export function searchBooks(list: readonly Recent[], query: string): Recent[] {
  if (query.trim() === "") return [...list];
  return list.filter((r) => {
    const { author, series } = infoOf(r);
    return [r.title, author, series ?? ""].some((text) => fuzzyMatch(query, text) !== null);
  });
}

export interface BookGroup {
  /** The series text, or null for the books that belong to none. */
  series: string | null;
  books: Recent[];
}

/**
 * Groups already-sorted books by series. Groups appear where their first book does, standalone books last; inside a series the
 * books follow their number (the order they are read in), then the incoming order.
 */
export function groupBySeries(list: readonly Recent[]): BookGroup[] {
  const groups = new Map<string, Recent[]>();
  const alone: Recent[] = [];
  for (const r of list) {
    const { series } = infoOf(r);
    if (series === undefined) alone.push(r);
    else groups.set(series, [...(groups.get(series) ?? []), r]);
  }
  const out: BookGroup[] = [...groups].map(([series, books]) => ({
    series,
    books: [...books].sort(
      (a, b) => numberOf(infoOf(a).seriesNumber) - numberOf(infoOf(b).seriesNumber),
    ),
  }));
  if (alone.length > 0) out.push({ series: null, books: alone });
  return out;
}

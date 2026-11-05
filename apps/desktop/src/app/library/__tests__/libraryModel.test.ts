import { describe, expect, it } from "vitest";
import type { Recent } from "../../../state/recents";
import { groupBySeries, infoOf, libraryFields, searchBooks, sortBooks } from "../libraryModel";

const stats = (author: string, words: number, over: Record<string, string> = {}) => ({
  author,
  chapters: 3,
  words,
  chapterNo: 1,
  chapterTitle: "",
  ...over,
});
const book = (root: string, title: string, over: Partial<Recent> = {}): Recent => ({
  root,
  title,
  openedAt: 10,
  ...over,
});

const LIST: Recent[] = [
  book("/a", "Moon Tide", {
    editedAt: 50,
    stats: stats("Mara", 900, { series: "Tides", seriesNumber: "2" }),
  }),
  book("/b", "High Tide", {
    editedAt: 90,
    stats: stats("Ada", 5000, { series: "Tides", seriesNumber: "1" }),
  }),
  book("/c", "Zebra", { openedAt: 70, stats: stats("Ben", 100) }),
  book("/d", "Anchor", { openedAt: 0, scanned: { author: "", series: "Harbour" } }),
  book("/e", "10 Lighthouses", { openedAt: 5 }),
  book("/f", "2 Lighthouses", { openedAt: 5 }),
];

const roots = (l: Recent[]) => l.map((r) => r.root);

describe("library fields of an edition", () => {
  it("caches the cover, the series and its number", () => {
    expect(
      libraryFields({ cover: "assets/c.png", publishing: { series: "S", seriesNumber: "3" } }),
    ).toEqual({
      cover: "assets/c.png",
      series: "S",
      seriesNumber: "3",
    });
  });
  it("leaves out what is not set", () => {
    expect(libraryFields({ cover: null })).toEqual({});
    expect(libraryFields({ cover: null, publishing: { seriesNumber: "3" } })).toEqual({});
    expect(libraryFields({ cover: null, publishing: { series: "S" } })).toEqual({ series: "S" });
  });
});

describe("what a row knows", () => {
  it("reads opened books from their stats and scanned ones from the scan", () => {
    expect(infoOf(LIST[0]!)).toMatchObject({
      author: "Mara",
      words: 900,
      chapters: 3,
      series: "Tides",
      seriesNumber: "2",
      editedAt: 50,
    });
    expect(infoOf(LIST[3]!)).toMatchObject({
      author: "",
      words: null,
      chapters: null,
      series: "Harbour",
      editedAt: 0,
    });
    expect(infoOf(LIST[4]!)).toMatchObject({
      author: "",
      words: null,
      series: undefined,
      editedAt: 5,
    });
  });
});

describe("sorting", () => {
  it("puts the last edited first, falling back to when it was opened", () => {
    expect(roots(sortBooks(LIST, "edited", "en"))).toEqual(["/b", "/c", "/a", "/f", "/e", "/d"]);
  });
  it("sorts titles with numbers by value, not letter by letter", () => {
    expect(roots(sortBooks(LIST, "title", "en"))).toEqual(["/f", "/e", "/d", "/b", "/a", "/c"]);
  });
  it("sorts by author with books that have none last", () => {
    expect(roots(sortBooks(LIST, "author", "en")).slice(0, 3)).toEqual(["/b", "/c", "/a"]);
    expect(roots(sortBooks(LIST, "author", "en")).slice(3)).toEqual(["/f", "/e", "/d"]);
  });
  it("puts the longest first, books of unknown size last", () => {
    expect(roots(sortBooks(LIST, "words", "en"))).toEqual(["/b", "/a", "/c", "/f", "/e", "/d"]);
  });
  it("orders a series by number, standalone books after", () => {
    expect(roots(sortBooks(LIST, "series", "en"))).toEqual(["/d", "/b", "/a", "/f", "/e", "/c"]);
  });
  it("does not change the list it is given", () => {
    const copy = [...LIST];
    sortBooks(LIST, "title", "en");
    expect(LIST).toEqual(copy);
  });
});

describe("searching", () => {
  it("returns everything for an empty query", () => {
    expect(searchBooks(LIST, "  ")).toHaveLength(LIST.length);
  });
  it("matches title, author and series, ignoring case and gaps", () => {
    expect(roots(searchBooks(LIST, "tide"))).toEqual(["/a", "/b"]);
    expect(roots(searchBooks(LIST, "BEN"))).toEqual(["/c"]);
    expect(roots(searchBooks(LIST, "harb"))).toEqual(["/d"]);
    expect(roots(searchBooks(LIST, "mnt"))).toEqual(["/a"]);
    expect(searchBooks(LIST, "qqq")).toEqual([]);
  });
});

describe("grouping by series", () => {
  it("makes a group per series ordered by number, then the standalone books", () => {
    const g = groupBySeries(sortBooks(LIST, "title", "en"));
    expect(g.map((x) => x.series)).toEqual(["Harbour", "Tides", null]);
    expect(roots(g[1]!.books)).toEqual(["/b", "/a"]);
    expect(roots(g[2]!.books)).toEqual(["/f", "/e", "/c"]);
  });
  it("has no empty standalone group", () => {
    expect(groupBySeries([LIST[0]!]).map((x) => x.series)).toEqual(["Tides"]);
    expect(groupBySeries([])).toEqual([]);
  });
  it("puts an unnumbered book after the numbered ones", () => {
    const g = groupBySeries([
      book("/x", "X", { scanned: { author: "", series: "S" } }),
      book("/y", "Y", { scanned: { author: "", series: "S", seriesNumber: "1" } }),
    ]);
    expect(roots(g[0]!.books)).toEqual(["/y", "/x"]);
  });
});

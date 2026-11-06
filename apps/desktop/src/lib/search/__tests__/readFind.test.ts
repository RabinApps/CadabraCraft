import { describe, expect, it } from "vitest";
import type { BookPage } from "../../../state/project/types";
import {
  firstIndexOf,
  locate,
  readMatches,
  readRows,
  startIndex,
  stepIndex,
  type Hit,
} from "../readFind";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const page = (id: string, section: BookPage["section"], ...texts: string[]): BookPage =>
  ({
    id,
    title: id.toUpperCase(),
    section,
    doc: { type: "doc", content: texts.map(para) },
  }) as BookPage;

const opts = { query: "cat", matchCase: false, wholeWord: false, regex: false };
const pages = [
  page("f", "front", "A cat."),
  page("a", "chapter", "no match here"),
  page("b", "chapter", "cat cat", "Cat"),
  page("z", "back", "the cat"),
];

describe("readMatches", () => {
  it("counts every page in reading order and keeps its section", () => {
    const m = readMatches(pages, opts);
    expect(m.total).toBe(5);
    expect(m.hits).toEqual([
      { id: "f", title: "F", section: "front", count: 1 },
      { id: "b", title: "B", section: "chapter", count: 3 },
      { id: "z", title: "Z", section: "back", count: 1 },
    ]);
  });
  it("honours the options and finds nothing for an empty query", () => {
    expect(readMatches(pages, { ...opts, matchCase: true }).total).toBe(4);
    expect(readMatches(pages, { ...opts, wholeWord: true, query: "ca" }).total).toBe(0);
    expect(readMatches(pages, { ...opts, query: "" }).total).toBe(0);
    expect(readMatches(pages, { ...opts, regex: true, query: "c.t" }).total).toBe(5);
  });
});

describe("locating a match", () => {
  const { hits } = readMatches(pages, opts);
  it("maps the book-wide number to a page and the number inside it", () => {
    expect(locate(hits, 0)).toEqual({ id: "f", local: 0 });
    expect(locate(hits, 1)).toEqual({ id: "b", local: 0 });
    expect(locate(hits, 3)).toEqual({ id: "b", local: 2 });
    expect(locate(hits, 4)).toEqual({ id: "z", local: 0 });
    expect(locate(hits, 5)).toBeNull();
    expect(locate(hits, -1)).toBeNull();
  });
  it("gives the first match of a page", () => {
    expect(firstIndexOf(hits, "b")).toBe(1);
    expect(firstIndexOf(hits, "z")).toBe(4);
    expect(firstIndexOf(hits, "a")).toBeNull();
  });
});

describe("where a search starts", () => {
  const { hits } = readMatches(pages, opts);
  const order = pages.map((p) => p.id);
  it("is the first match on the reading line's page, else on the next page with one", () => {
    expect(startIndex(hits, order, "b")).toBe(1);
    expect(startIndex(hits, order, "a")).toBe(1);
    expect(startIndex(hits, order, "z")).toBe(4);
  });
  it("wraps to the start of the book and copes with no position or no matches", () => {
    const late: Hit[] = [hits[0]!];
    expect(startIndex(late, order, "z")).toBe(0);
    expect(startIndex(hits, order, null)).toBe(0);
    expect(startIndex(hits, order, "gone")).toBe(0);
    expect(startIndex([], order, "a")).toBe(-1);
    expect(startIndex(hits, [], "a")).toBe(0);
  });
});

describe("stepping", () => {
  it("wraps in both directions", () => {
    expect(stepIndex(0, 5, 1)).toBe(1);
    expect(stepIndex(4, 5, 1)).toBe(0);
    expect(stepIndex(0, 5, -1)).toBe(4);
  });
  it("starts at the first or the last match when none is current, and is -1 without matches", () => {
    expect(stepIndex(-1, 5, 1)).toBe(0);
    expect(stepIndex(-1, 5, -1)).toBe(4);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("the results list", () => {
  it("marks the page that holds the current match", () => {
    const { hits } = readMatches(pages, opts);
    expect(readRows(hits, 2).map((r) => [r.id, r.count, r.current])).toEqual([
      ["f", 1, false],
      ["b", 3, true],
      ["z", 1, false],
    ]);
    expect(readRows(hits, -1).some((r) => r.current)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { mergeAdjacentText, bookPosition, bookStep, countLabel, resultRows, prefillQuery } from "./findHelpers";

describe("mergeAdjacentText", () => {
  const bold = [{ type: "bold" }];
  it("joins neighbours with equal marks only, at any depth", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "a " }, { type: "text", text: "dog" }, { type: "text", text: " x", marks: bold }, { type: "text", text: "y", marks: bold }, { type: "text", text: "z" },
    ] }] };
    expect(mergeAdjacentText(doc).content[0]!.content).toEqual([
      { type: "text", text: "a dog" }, { type: "text", text: " xy", marks: bold }, { type: "text", text: "z" },
    ]);
  });
});

const order =["front", "a", "b", "c", "back"];
describe("bookPosition", () => {
  it("counts pages in reading order and uses the live state of the open page", () => {
    const counts = { front: 1, a: 99, b: 2, back: 4 };
    expect(bookPosition(order, counts, "b", { total: 3, index: 2 })).toEqual({ total: 1 + 99 + 3 + 4, index: 1 + 99 + 2 });
  });
  it("has no current index when the open page has no match", () => {
    expect(bookPosition(order, { a: 2, c: 1 }, "b", { total: 0, index: 0 })).toEqual({ total: 3, index: 0 });
  });
});

describe("bookStep", () => {
  const counts = { front: 1, b: 2, back: 1 };
  it("steps inside the open page while there is a next/previous match there", () => {
    expect(bookStep(order, counts, "b", { total: 2, index: 1 }, 1)).toEqual({ to: "stay" });
    expect(bookStep(order, counts, "b", { total: 2, index: 2 }, -1)).toEqual({ to: "stay" });
  });
  it("moves to the next page with matches, first match forward and last match backward", () => {
    expect(bookStep(order, counts, "b", { total: 2, index: 2 }, 1)).toEqual({ to: "page", id: "back", at: "first" });
    expect(bookStep(order, counts, "b", { total: 2, index: 1 }, -1)).toEqual({ to: "page", id: "front", at: "last" });
  });
  it("wraps around the book and skips pages without matches", () => {
    expect(bookStep(order, counts, "back", { total: 1, index: 1 }, 1)).toEqual({ to: "page", id: "front", at: "first" });
    expect(bookStep(order, counts, "front", { total: 1, index: 1 }, -1)).toEqual({ to: "page", id: "back", at: "last" });
  });
  it("wraps inside the only page with matches, and from a page with none", () => {
    expect(bookStep(order, { b: 2 }, "b", { total: 2, index: 2 }, 1)).toEqual({ to: "stay" });
    expect(bookStep(order, { b: 2 }, "c", { total: 0, index: 0 }, 1)).toEqual({ to: "page", id: "b", at: "first" });
    expect(bookStep(order, {}, "c", { total: 0, index: 0 }, 1)).toBeNull();
  });
});

describe("resultRows", () => {
  const book = {
    frontMatter: [{ id: "f", title: "Dedication" }],
    chapters: [{ id: "a", title: "One" }, { id: "b", title: "Two" }, { id: "c", title: "Three" }],
    backMatter: [{ id: "k", title: "About" }],
  };
  it("lists only pages with matches, in reading order, with sections", () => {
    const rows = resultRows(book, { f: 1, a: 2, c: 0, k: 3 }, null, { total: 0, index: 0 });
    expect(rows.map((r) => [r.id, r.section, r.count, r.current])).toEqual([["f", "front", 1, false], ["a", "chapter", 2, false], ["k", "back", 3, false]]);
  });
  it("uses the live count for the open page and marks it current only with a current match", () => {
    expect(resultRows(book, { a: 5 }, "a", { total: 2, index: 1 })).toEqual([{ id: "a", title: "One", section: "chapter", count: 2, current: true }]);
    expect(resultRows(book, { a: 5 }, "a", { total: 2, index: 0 })[0]!.current).toBe(false);
    expect(resultRows(book, { a: 5 }, "a", { total: 0, index: 0 })).toEqual([]);
  });
});

describe("prefillQuery", () => {
  it("takes a short single-line selection as is", () => {
    expect(prefillQuery("dragon")).toBe("dragon");
    expect(prefillQuery("two words")).toBe("two words");
  });
  it("ignores empty, blank, multi-line and long selections", () => {
    expect(prefillQuery("")).toBeNull();
    expect(prefillQuery("   ")).toBeNull();
    expect(prefillQuery("one\ntwo")).toBeNull();
    expect(prefillQuery("x".repeat(99))).toBe("x".repeat(99));
    expect(prefillQuery("x".repeat(100))).toBeNull();
  });
});

describe("countLabel", () => {
  it("says which match of how many", () => expect(countLabel("a", 12, 3)).toBe("3 of 12"));
  it("says No results only for a non-empty query", () => {
    expect(countLabel("zzz", 0, 0)).toBe("No results");
    expect(countLabel("", 0, 0)).toBe("");
  });
});

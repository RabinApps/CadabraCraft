import { beforeEach, describe, expect, it } from "vitest";
import { MAX_QUERY_CHARS, MAX_REPLACEMENT_CHARS, useFind } from "../findStore";
import {
  bookPosition,
  bookStep,
  countLabel,
  isComposing,
  prefillQuery,
  resultRows,
} from "../../lib/search/findHelpers";

beforeEach(() => useFind.setState({ open: false, query: "", replacement: "" }));

describe("find store limits", () => {
  it("cuts a query and a replacement that are too long, however they arrive", () => {
    useFind
      .getState()
      .set({
        query: "q".repeat(MAX_QUERY_CHARS + 50),
        replacement: "r".repeat(MAX_REPLACEMENT_CHARS + 50),
      });
    expect(useFind.getState().query).toHaveLength(MAX_QUERY_CHARS);
    expect(useFind.getState().replacement).toHaveLength(MAX_REPLACEMENT_CHARS);
    useFind.getState().show({ query: "z".repeat(5000) });
    expect(useFind.getState().query).toHaveLength(MAX_QUERY_CHARS);
    useFind.getState().toggleReplace("y".repeat(5000));
    expect(useFind.getState().query).toHaveLength(MAX_QUERY_CHARS);
  });
  it("keeps a whitespace-only query as typed (it searches for that whitespace)", () => {
    useFind.getState().set({ query: "   " });
    expect(useFind.getState().query).toBe("   ");
    expect(countLabel("   ", 0, 0)).not.toBe("");
  });
  it("does not prefill from a blank or multi-line selection", () => {
    expect(prefillQuery("   ")).toBeNull();
    expect(prefillQuery("a\nb")).toBeNull();
    expect(prefillQuery("x".repeat(100))).toBeNull();
  });
});

describe("IME composition", () => {
  it("treats isComposing and keyCode 229 as composing", () => {
    expect(isComposing({ isComposing: true })).toBe(true);
    expect(isComposing({ keyCode: 229 })).toBe(true);
    expect(isComposing({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isComposing({})).toBe(false);
  });
});

describe("book helpers with nothing to find", () => {
  const order = ["a", "b", "c"];
  it("Enter and Shift+Enter with no matches anywhere go nowhere", () => {
    expect(bookStep(order, {}, "a", { total: 0, index: 0 }, 1)).toBeNull();
    expect(bookStep(order, {}, "a", { total: 0, index: 0 }, -1)).toBeNull();
    expect(bookStep([], {}, null, { total: 0, index: 0 }, 1)).toBeNull();
    expect(bookStep(["a"], {}, "a", { total: 0, index: 0 }, 1)).toBeNull();
  });
  it("ignores counts of pages that no longer exist", () => {
    expect(bookPosition(order, { gone: 7, b: 2 }, "a", { total: 1, index: 1 })).toEqual({
      total: 3,
      index: 1,
    });
    const rows = resultRows(
      { frontMatter: [], chapters: [{ id: "a", title: "A" }], backMatter: [] },
      { gone: 7, a: 1 },
      null,
      { total: 0, index: 0 },
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("copes with a current page that is not in the book (deleted while open)", () => {
    expect(bookStep(order, { b: 1 }, "deleted", { total: 0, index: 0 }, 1)).toEqual({
      to: "page",
      id: "b",
      at: "first",
    });
    expect(bookPosition(order, { b: 1 }, "deleted", { total: 0, index: 0 })).toEqual({
      total: 1,
      index: 0,
    });
  });
});

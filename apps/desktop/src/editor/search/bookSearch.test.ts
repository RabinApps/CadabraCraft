import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { findInDoc, replaceInDoc, searchBook } from "./bookSearch";

const t = (text: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const o = { query: "cat", matchCase: false, wholeWord: false };
const bold = [{ type: "bold" }];

describe("searchBook", () => {
  it("counts per page and skips pages without matches", () => {
    const pages = [
      { id: "a", title: "A", doc: doc(p(t("Cat cat CAT")), p(t("a cat"))) },
      { id: "b", title: "B", doc: doc(p(t("dog"))) },
      { id: "c", title: "C", doc: doc(p(t("cat"))) },
    ];
    expect(searchBook(pages, o)).toEqual({ total: 5, pages: [{ id: "a", title: "A", count: 4 }, { id: "c", title: "C", count: 1 }] });
    expect(searchBook(pages, { ...o, matchCase: true }).total).toBe(3);
    expect(searchBook(pages, { ...o, wholeWord: true, query: "ca" }).total).toBe(0);
  });

  it("returns nothing for an empty query", () => {
    expect(searchBook([{ id: "a", title: "A", doc: doc(p(t("cat"))) }], { ...o, query: "" })).toEqual({ total: 0, pages: [] });
  });
});

describe("findInDoc", () => {
  it("reports positions within a run, across adjacent marked text nodes", () => {
    expect(findInDoc(doc(p(t("a ca"), t("t b", bold))), o)).toEqual([{ path: [0], from: 2, to: 5 }]);
  });

  it("never crosses hard breaks, footnotes or paragraphs", () => {
    const d = doc(p(t("ca"), { type: "hardBreak" }, t("t")), p(t("ca")), p(t("t")), p(t("ca"), { type: "footnote", content: [t("t cat")] }, t("t")));
    expect(findInDoc(d, o)).toEqual([{ path: [3, 1], from: 2, to: 5 }]);
  });
});

describe("replaceInDoc", () => {
  it("replaces, preserves marks and does not mutate the input", () => {
    const d = doc(p(t("a "), t("cat", bold), t(" and Cat")));
    const copy = structuredClone(d);
    const r = replaceInDoc(d, o, "dog");
    expect(r.count).toBe(2);
    expect(r.doc).toEqual(doc(p(t("a "), t("dog", bold), t(" and "), t("dog"))));
    expect(d).toEqual(copy);
  });

  it("handles a match spanning nodes, taking the first character's marks", () => {
    const r = replaceInDoc(doc(p(t("xca", bold), t("ty"))), o, "dog");
    expect(r.doc).toEqual(doc(p(t("x", bold), t("dog", bold), t("y"))));
  });

  it("deletes with an empty replacement and drops empty nodes", () => {
    expect(replaceInDoc(doc(p(t("cat", bold), t("!"))), o, "").doc).toEqual(doc(p(t("!"))));
  });

  it("replaces inside footnotes and keeps other nodes", () => {
    const d = doc(p(t("cat"), { type: "footnote", content: [t("cat")] }, t("cat")));
    const r = replaceInDoc(d, o, "x");
    expect(r.count).toBe(3);
    expect(r.doc).toEqual(doc(p(t("x"), { type: "footnote", content: [t("x")] }, t("x"))));
  });

  it("is a no-op for an empty query or no match", () => {
    const d = doc(p(t("cat")));
    expect(replaceInDoc(d, { ...o, query: "" }, "x")).toEqual({ doc: d, count: 0 });
    expect(replaceInDoc(d, { ...o, query: "zzz" }, "x").doc).toBe(d);
  });

  it("honors whole word", () => {
    expect(replaceInDoc(doc(p(t("cat concat cat"))), { ...o, wholeWord: true }, "x").doc).toEqual(doc(p(t("x"), t(" concat "), t("x"))));
  });
});

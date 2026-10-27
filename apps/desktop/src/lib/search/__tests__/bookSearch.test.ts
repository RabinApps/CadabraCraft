import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { findInDoc, replaceInDoc, searchBook } from "../bookSearch";

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

describe("regex mode", () => {
  const rx = { query: "(\\w+)@(\\w+)", matchCase: false, wholeWord: false, regex: true };
  const pages = [{ id: "a", title: "A", doc: doc(p(t("me@home you@work")), p(t("none"))) }, { id: "b", title: "B", doc: doc(p(t("x@y"))) }];

  it("counts per page", () => {
    expect(searchBook(pages, rx)).toEqual({ total: 3, pages: [{ id: "a", title: "A", count: 2 }, { id: "b", title: "B", count: 1 }] });
    expect(findInDoc(pages[0]!.doc, rx)).toEqual([{ path: [0], from: 0, to: 7 }, { path: [0], from: 8, to: 16 }]);
  });

  it("replaces with captures, $& and $$, across text nodes, keeping marks", () => {
    const d = doc(p(t("me@"), t("home", bold), t(" end")));
    expect(replaceInDoc(d, rx, "$2 at $1 ($&) $$").doc).toEqual(doc(p(t("home at me (me@home) $"), t(" end"))));
    const marked = replaceInDoc(doc(p(t("a", bold), t("b@c"))), rx, "$2$1").doc;
    expect(marked).toEqual(doc(p(t("cab", bold))));
  });

  it("uses UTF-16 offsets after emoji and rejects unsupported syntax", () => {
    expect(findInDoc(doc(p(t("😀😀 me@home"))), rx)).toEqual([{ path: [0], from: 5, to: 12 }]);
    expect(findInDoc(doc(p(t("ab"))), { ...rx, query: "a(?=b)" })).toEqual([]);
  });

  it("keeps the replacement literal with regex off", () => {
    expect(replaceInDoc(doc(p(t("cat"))), { ...o, regex: false }, "$1 $&").doc).toEqual(doc(p(t("$1 $&"))));
  });

  it("finds nothing for an invalid or zero-length pattern and returns the same doc", () => {
    const d = doc(p(t("aaa")));
    expect(searchBook([{ id: "a", title: "A", doc: d }], { ...rx, query: "(" }).total).toBe(0);
    expect(replaceInDoc(d, { ...rx, query: "(" }, "x").doc).toBe(d);
    expect(replaceInDoc(d, { ...rx, query: "b*" }, "x")).toEqual({ doc: d, count: 0 });
    expect(replaceInDoc(doc(p(t("baab"))), { ...rx, query: "a*" }, "-").doc).toEqual(doc(p(t("b"), t("-"), t("b"))));
  });

  it("never matches across blocks or hard breaks", () => {
    const d = doc(p(t("foo")), p(t("bar"), { type: "hardBreak" }, t("baz")));
    expect(findInDoc(d, { ...rx, query: "foo\\s*bar|bar\\s*baz" })).toEqual([]);
  });

  it("applies whole word and Match case", () => {
    const d = doc(p(t("Cat concat")));
    expect(findInDoc(d, { ...rx, query: "c.t", wholeWord: true })).toHaveLength(1);
    expect(findInDoc(d, { ...rx, query: "c.t", matchCase: true })).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { getSchema } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import { Search, replaceAllTransaction, searchKey, setSearchTransaction } from "../plugin";
import { replaceInDoc, searchBook } from "../../../lib/search/bookSearch";
import { compileRegex, expandReplacement, findInText, isInvalidRegex, MAX_MATCHES } from "../../../lib/search/match";

const schema = getSchema(extensions);
const plugins = Search.config.addProseMirrorPlugins!.call({} as never);
const para = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const o = { matchCase: false, wholeWord: false };
interface J { text?: string; content?: J[] }
const textOf = (n: J): string => n.text ?? (n.content ?? []).map(textOf).join("");

describe("regex caps", () => {
  const many = "a".repeat(MAX_MATCHES * 2 + 5);
  it("Replace all in the book replaces every match, not just the first MAX_MATCHES", () => {
    const doc = { type: "doc", content: [para(many)] };
    const r = replaceInDoc(doc, { ...o, query: "a", regex: true }, "b");
    expect(r.count).toBe(many.length);
    expect(textOf(r.doc)).toBe("b".repeat(many.length));
  });
  it("Replace all in the open page replaces every match, while the display set stays capped", () => {
    let s = EditorState.create({ doc: schema.nodeFromJSON({ type: "doc", content: [para(many)] }), plugins });
    s = s.apply(setSearchTransaction(s, { query: "a", regex: true, replacement: "b" }));
    expect(searchKey.getState(s)!.matches.length).toBe(MAX_MATCHES);
    s = s.apply(replaceAllTransaction(s)!);
    expect(s.doc.textContent).toBe("b".repeat(many.length));
  });
  it("searchBook still reports a capped count for display", () => {
    const r = searchBook([{ id: "x", title: "X", doc: { type: "doc", content: [para(many)] } }], { ...o, query: "a", regex: true });
    expect(r.total).toBe(MAX_MATCHES);
  });
});

describe("invalid and pathological regexes", () => {
  it("reports invalid syntax without throwing", () => {
    for (const q of ["(", "[a-", "a{2,1}", "(?<=x)y", "\\1(a)", "*", "a**", "\\", "[[:nope:]]"]) {
      expect(() => findInText("some text", q, { ...o, regex: true })).not.toThrow();
      expect(findInText("some text", q, { ...o, regex: true })).toEqual([]);
      expect(isInvalidRegex(q, false)).toBe(true);
    }
  });
  it("handles a nested-quantifier pattern and a long pattern in linear time", () => {
    const t0 = Date.now();
    expect(findInText("a".repeat(30), "(a+)+$", { ...o, regex: true }).length).toBe(1);
    findInText("a".repeat(100_000) + "!", "(a|aa)+$", { ...o, regex: true });
    compileRegex("a".repeat(5000), false);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("searches a very large chapter in bounded time", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(40_000);
    const t0 = Date.now();
    const r = findInText(text, "\\bfox\\b|d.g", { ...o, regex: true });
    expect(r.length).toBe(MAX_MATCHES);
    expect(findInText(text, "fox", o).length).toBe(40_000);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
  it("matches zero-length patterns without looping", () => {
    expect(findInText("abc", "x*", { ...o, regex: true })).toEqual([]);
    expect(findInText("", "a", { ...o, regex: true })).toEqual([]);
  });
});

describe("whitespace and special queries", () => {
  it("a whitespace-only literal query finds runs of that whitespace", () => {
    expect(findInText("a  b   c", "  ", o).map((m) => m.from)).toEqual([1, 4]);
  });
  it("an empty query matches nothing in either mode", () => {
    expect(findInText("abc", "", o)).toEqual([]);
    expect(findInText("abc", "", { ...o, regex: true })).toEqual([]);
  });
  it("dollar sequences stay literal when Regex is off", () => {
    const doc = { type: "doc", content: [para("price cat")] };
    const r = replaceInDoc(doc, { ...o, query: "cat", regex: false }, "$1 $& $$ \\1");
    expect(textOf(r.doc)).toBe("price $1 $& $$ \\1");
    expect(expandReplacement({ from: 0, to: 3, captures: ["cat"] }, "$&$1", false)).toBe("$&$1");
  });
  it("expands them when Regex is on, leaves unknown ones and out-of-range groups alone", () => {
    const range = { from: 0, to: 3, captures: ["ab", "a"] };
    expect(expandReplacement(range, "$1-$&-$$-$2-$x-$0", true)).toBe("a-ab-$-$2-$x-$0");
  });
});

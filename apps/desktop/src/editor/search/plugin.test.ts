import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { getSchema } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { extensions } from "@cadabracraft/editor-schema";
import {
  Search, replaceAllTransaction, replaceCurrentTransaction, searchKey, setSearchTransaction, stepTransaction,
} from "./plugin";

// Headless: the plugin and transactions need no DOM (the repo has no jsdom), so tests drive a bare EditorState.
const schema = getSchema(extensions);
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const t = (text: string, marks?: string[]) => ({ type: "text", text, ...(marks && { marks: marks.map((type) => ({ type })) }) });
const br = { type: "hardBreak" };

const plugins = Search.config.addProseMirrorPlugins!.call({} as never);
function make(content: unknown[]) {
  return EditorState.create({ doc: schema.nodeFromJSON({ type: "doc", content }), plugins: [history(), ...plugins] });
}
const apply = (state: EditorState, tr: Transaction | null) => state.apply(tr!);
const search = (state: EditorState, partial: Parameters<typeof setSearchTransaction>[1]) => apply(state, setSearchTransaction(state, partial));
const get = (s: EditorState) => searchKey.getState(s)!;
const texts = (s: EditorState) => get(s).matches.map((m) => s.doc.textBetween(m.from, m.to));
const info = (s: EditorState) => ({ total: get(s).matches.length, index: get(s).current + 1 });

describe("search plugin", () => {
  it("does nothing for an empty query, even as the document changes", () => {
    let s = make([p(t("hello"))]);
    const before = get(s);
    s = s.apply(s.tr.insertText("x", 1));
    expect(get(s)).toBe(before);
    expect(info(s)).toEqual({ total: 0, index: 0 });
  });

  it("never matches across paragraphs or inline nodes", () => {
    expect(get(search(make([p(t("foo")), p(t("bar"))]), { query: "foobar" })).matches).toEqual([]);
    expect(get(search(make([p(t("fo"), br, t("o"))]), { query: "foo" })).matches).toEqual([]);
    expect(texts(search(make([p(t("foo")), p(t("fo"), t("o", ["bold"]))]), { query: "foo" }))).toEqual(["foo", "foo"]);
  });

  it("searches code blocks and footnote text", () => {
    const s = search(make([{ type: "codeBlock", content: [t("let cat")] }, p(t("x"), { type: "footnote", content: [t("a cat")] })]), { query: "cat" });
    expect(texts(s)).toEqual(["cat", "cat"]);
  });

  it("reports a 1-based index and wraps around", () => {
    let s = search(make([p(t("a b a b a"))]), { query: "a" });
    expect(info(s)).toEqual({ total: 3, index: 1 });
    s = apply(s, stepTransaction(s, -1, false));
    expect(info(s).index).toBe(3);
    s = apply(s, stepTransaction(s, 1, false));
    expect(info(s).index).toBe(1);
  });

  it("selects the match only when asked to reveal", () => {
    let s = search(make([p(t("one two one"))]), { query: "two" });
    const sel = s.selection.from;
    expect(apply(s, stepTransaction(s, 1, false)).selection.from).toBe(sel);
    s = apply(s, stepTransaction(s, 1, true));
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe("two");
  });

  it("keeps matches in place when typing before them", () => {
    let s = search(make([p(t("say hello"))]), { query: "hello" });
    const before = get(s).matches[0]!;
    s = s.apply(s.tr.insertText("well ", 1));
    expect(get(s).matches[0]).toEqual({ from: before.from + 5, to: before.to + 5 });
    expect(texts(s)).toEqual(["hello"]);
  });

  it("drops a match whose text was edited", () => {
    let s = search(make([p(t("say hello"))]), { query: "hello" });
    s = s.apply(s.tr.insertText("J", 6, 7));
    expect(get(s).matches).toEqual([]);
  });

  it("replaceAll is one undo step and keeps the marks", () => {
    let s = search(make([p(t("a "), t("cat", ["bold"]), t(" and a cat"))]), { query: "cat", replacement: "dog" });
    const original = s.doc;
    s = apply(s, replaceAllTransaction(s));
    expect(s.doc.textContent).toBe("a dog and a dog");
    expect(s.doc.firstChild!.child(1).marks.map((m) => m.type.name)).toEqual(["bold"]);
    expect(get(s).matches).toEqual([]);
    let undone: PMNode = s.doc;
    undo(s, (tr) => { undone = s.apply(tr).doc; });
    expect(undone.eq(original)).toBe(true);
  });

  it("does not loop when the replacement contains the query", () => {
    let s = search(make([p(t("a a"))]), { query: "a", replacement: "aa" });
    s = apply(s, replaceAllTransaction(s));
    expect(s.doc.textContent).toBe("aa aa");
  });

  it("replacing with nothing deletes and never leaves an empty text node", () => {
    let s = search(make([p(t("cat"))]), { query: "cat", replacement: "" });
    s = apply(s, replaceAllTransaction(s));
    expect(s.doc.firstChild!.childCount).toBe(0);
    s = search(make([p(t("a cat b"))]), { query: "cat", replacement: "" });
    s = apply(s, replaceCurrentTransaction(s));
    expect(s.doc.textContent).toBe("a  b");
  });

  it("replaceCurrent replaces one and moves to the next", () => {
    let s = search(make([p(t("x x x"))]), { query: "x", replacement: "yy" });
    s = apply(s, replaceCurrentTransaction(s));
    expect(s.doc.textContent).toBe("yy x x");
    expect(info(s)).toEqual({ total: 2, index: 1 });
  });

  it("clears matches when the query is emptied", () => {
    const s = search(search(make([p(t("a"))]), { query: "a" }), { query: "" });
    expect(info(s)).toEqual({ total: 0, index: 0 });
  });

  it("draws search-match and search-match-current decorations", () => {
    const s = search(make([p(t("a a"))]), { query: "a" });
    const classes = get(s).decorations.find().map((d) => (d as unknown as { type: { attrs: { class: string } } }).type.attrs.class);
    expect(classes).toEqual(["search-match search-match-current", "search-match"]);
  });

  it("searches a 100k-word chapter well under the bound", () => {
    const word = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do ";
    const s = make(Array.from({ length: 1000 }, () => p(t(word.repeat(10)))));
    const start = performance.now();
    const found = search(s, { query: "dolor", wholeWord: true });
    const ms = performance.now() - start;
    expect(get(found).matches.length).toBe(10000);
    expect(ms).toBeLessThan(500);
  });

  it("regex: finds, replaces the current match with captures and replaces all", () => {
    let s = search(make([p(t("ab-12 cd-34"))]), { query: "([a-z]+)-(\\d+)", replacement: "$2:$1", regex: true });
    expect(texts(s)).toEqual(["ab-12", "cd-34"]);
    s = apply(s, replaceCurrentTransaction(s));
    expect(s.doc.textContent).toBe("12:ab cd-34");
    s = apply(s, replaceAllTransaction(s));
    expect(s.doc.textContent).toBe("12:ab 34:cd");
    s = search(s, { query: "(", regex: true });
    expect(info(s)).toEqual({ total: 0, index: 0 });
    expect(replaceAllTransaction(s)).toBeNull();
  });
});

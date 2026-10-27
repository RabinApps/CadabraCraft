import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { Node as PMNode } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import { MAX_HTML_CHARS, crossesCells, insertConverted, pasteAction, safeLooksLikeHtml, truncate, tryConvertHtmlText } from "../htmlPaste";

const base = { text: "<p>The gate was <b>old</b></p>", hasHtml: false, inCode: false, pref: "ask" as const };
const schema = getSchema(extensions);
const p = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (text: string, type = "tableCell") => ({ type, content: [p(text)] });
const stateOf = (content: unknown[]) => EditorState.create({ schema, doc: PMNode.fromJSON(schema, { type: "doc", content }) });
/** Position of the first occurrence of `marker` text (or just after it). */
function posOf(state: EditorState, marker: string, end = false): number {
  let found = -1;
  state.doc.descendants((n, pos) => {
    if (found < 0 && n.isText && n.text!.includes(marker)) found = pos + n.text!.indexOf(marker) + (end ? marker.length : 0);
  });
  if (found < 0) throw new Error(`no ${marker}`);
  return found;
}
const apply = (s: EditorState, content: unknown[], from: number, to = from) => {
  const tr = insertConverted(s, content as never, { from, to });
  if (!tr) return null;
  tr.doc.check();
  return tr.doc;
};

describe("size limit and exceptions", () => {
  it("does not scan text above the limit and never throws", () => {
    const big = `<p>x</p>${"a".repeat(MAX_HTML_CHARS)}`;
    expect(safeLooksLikeHtml(big)).toBe(false);
    expect(pasteAction({ ...base, text: big })).toBe("default");
    expect(tryConvertHtmlText(big)).toBeNull();
  });
  it("treats a pile of nested blocks (ImportError) as plain text instead of throwing", () => {
    const deep = "<div>".repeat(5000);
    expect(() => pasteAction({ ...base, text: deep })).not.toThrow();
    expect(tryConvertHtmlText(deep)).toBeNull();
    const deepInline = `${"<blockquote>".repeat(600)}x`;
    expect(() => safeLooksLikeHtml(deepInline)).not.toThrow();
    expect(tryConvertHtmlText(deepInline)).toBeNull();
  });
  it("handles a large paste just under the limit quickly", () => {
    const text = "<p>The gate was <b>old</b></p>".repeat(30_000);
    expect(text.length).toBeLessThan(MAX_HTML_CHARS);
    const t0 = Date.now();
    const c = tryConvertHtmlText(text);
    expect(c?.content.length).toBe(30_000);
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe("truncate and preview safety", () => {
  it("cuts very long lines cheaply and turns control characters into spaces", () => {
    const out = truncate(`a\u0000b\u0007c${"z".repeat(5_000_000)}`);
    expect([...out].length).toBeLessThanOrEqual(121);
    expect(out).toContain("a b c");
    expect(out.endsWith("…")).toBe(true);
  });
  it("keeps right-to-left text and markup characters as plain text", () => {
    expect(truncate("שלום <script>alert(1)</script>")).toBe("שלום <script>alert(1)</script>");
  });
  it("does not split a surrogate pair", () => {
    expect(truncate("😀".repeat(200))).toBe(`${"😀".repeat(120)}…`);
  });
});

describe("insertConverted fits the schema", () => {
  const blocks = [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Head" }] }, p("Body"), { type: "bulletList", content: [{ type: "listItem", content: [p("li")] }] }];
  it("inserts blocks in a paragraph by splitting it", () => {
    const s = stateOf([p("Before after")]);
    expect(apply(s, blocks, posOf(s, "Before ", true))!.childCount).toBeGreaterThan(3);
  });
  it("flattens blocks into plain paragraphs inside a table cell", () => {
    const s = stateOf([{ type: "table", content: [{ type: "tableRow", content: [cell("one"), cell("two")] }] }]);
    const doc = apply(s, blocks, posOf(s, "one", true))!;
    const first = doc.firstChild!.firstChild!.firstChild!;
    expect(first.childCount).toBeGreaterThan(1);
    first.forEach((c) => expect(c.type.name).toBe("paragraph"));
  });
  it("flattens blocks into one text run inside a heading", () => {
    const s = stateOf([{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }]);
    const doc = apply(s, blocks, posOf(s, "Title", true))!;
    expect(doc.childCount).toBe(1);
    expect(doc.textContent).toBe("TitleHead Body li");
  });
  it("keeps styled inline text styled inside a heading", () => {
    const s = stateOf([{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }]);
    const doc = apply(s, [{ type: "text", text: "mark", marks: [{ type: "underline" }] }], posOf(s, "Title", true))!;
    expect(doc.firstChild!.lastChild!.marks.map((m) => m.type.name)).toEqual(["underline"]);
  });
  it("drops marks inside a code block", () => {
    const s = stateOf([{ type: "codeBlock", content: [{ type: "text", text: "x" }] }]);
    const doc = apply(s, [{ type: "text", text: "mark", marks: [{ type: "bold" }] }], posOf(s, "x", true))!;
    expect(doc.textContent).toBe("xmark");
  });
  it("flattens inside a footnote", () => {
    const s = stateOf([{ type: "paragraph", content: [{ type: "text", text: "Hi" }, { type: "footnote", content: [{ type: "text", text: "note" }] }] }]);
    const doc = apply(s, blocks, posOf(s, "note", true))!;
    expect(doc.textContent).toContain("noteHead Body li");
    doc.descendants((n) => { if (n.type.name === "footnote") n.forEach((c) => expect(c.isText).toBe(true)); });
  });
  it("replaces a non-empty selection in one transaction", () => {
    const s = stateOf([p("one two three")]);
    const from = posOf(s, "two");
    const tr = insertConverted(s, [{ type: "text", text: "2", marks: [{ type: "bold" }] }], { from, to: from + 3 })!;
    expect(tr.doc.textContent).toBe("one 2 three");
  });
  it("replacing a whole paragraph's text with styled inline content keeps the paragraph and the marks", () => {
    const s = stateOf([{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }, p("<u>mark</u>")]);
    const from = posOf(s, "<u>mark</u>");
    const doc = apply(s, [{ type: "text", text: "mark", marks: [{ type: "underline" }] }], from, from + "<u>mark</u>".length)!;
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).textContent).toBe("Title"); // the text must not slide up into the heading
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(1).firstChild!.marks.map((m) => m.type.name)).toEqual(["underline"]);
  });
  it("clamps a stale range to the document and returns null for empty content", () => {
    const s = stateOf([p("abc")]);
    expect(apply(s, [{ type: "text", text: "Z" }], 999)).not.toBeNull();
    expect(insertConverted(s, [], { from: 1, to: 1 })).toBeNull();
  });
  it("refuses a range across table cells", () => {
    const s = stateOf([{ type: "table", content: [{ type: "tableRow", content: [cell("one"), cell("two")] }] }]);
    const from = posOf(s, "one"), to = posOf(s, "two", true);
    expect(crossesCells(s, from, to)).toBe(true);
    expect(insertConverted(s, [{ type: "text", text: "x" }], { from, to })).toBeNull();
  });
  it("inserts into list items and blockquotes with a valid result", () => {
    const s = stateOf([{ type: "bulletList", content: [{ type: "listItem", content: [p("item")] }] }, { type: "blockquote", content: [p("quote")] }]);
    for (const m of ["item", "quote"]) expect(apply(s, blocks, posOf(s, m, true))).not.toBeNull();
  });
  it("falls back to plain text when the nodes cannot be built", () => {
    const s = stateOf([p("abc")]);
    const doc = apply(s, [{ type: "mystery", content: [{ type: "text", text: "kept" }] } as never], 2)!;
    expect(doc.textContent).toBe("akeptbc");
  });
});

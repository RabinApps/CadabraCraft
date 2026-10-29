import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { extensions } from "@cadabracraft/editor-schema";
import {
  docLeaves,
  hasHeaderRow,
  insideCell,
  isLeaf,
  leafWords,
  leafWordTexts,
  pageStartAt,
  plainItems,
  rowAround,
  wordOffset,
  wordsFrom,
} from "../exact";

// Headless: the real schema, no view.
const schema = getSchema(extensions);
const t = (text: string, marks?: string[]) => ({
  type: "text",
  text,
  ...(marks && { marks: marks.map((type) => ({ type })) }),
});
const p = (...c: unknown[]) => ({ type: "paragraph", content: c });
const br = { type: "hardBreak" };
const doc = (...content: unknown[]): PMNode => schema.nodeFromJSON({ type: "doc", content });
const li = (...c: unknown[]) => ({ type: "listItem", content: c });
const ul = (...items: unknown[]) => ({ type: "bulletList", content: items });
const cell = (kind: "tableCell" | "tableHeader", text: string) => ({
  type: kind,
  content: [p(t(text))],
});
const row = (kind: "tableCell" | "tableHeader", ...texts: string[]) => ({
  type: "tableRow",
  content: texts.map((x) => cell(kind, x)),
});
const table = (...rows: unknown[]) => ({ type: "table", content: rows });

describe("words", () => {
  it("counts and places words like the exporter marked them (flat offsets, a hard break takes one)", () => {
    const node = doc(p(t("one two "), t("three", ["bold"]), br, t("four  five"))).child(0);
    expect(plainItems(node)).toEqual(["one two ", "three", null, "four  five"]);
    expect(leafWords(node)).toBe(5);
    expect([0, 1, 2, 3, 4].map((w) => wordOffset(node, w))).toEqual([0, 4, 8, 14, 20]);
    expect(wordOffset(node, 5)).toBeNull();
  });

  it("takes footnotes and code as part of the text around them", () => {
    const node = doc(
      p(
        t("one "),
        t("two three", ["code"]),
        t(" four"),
        { type: "footnote", content: [t("a note")] },
        t(" five"),
      ),
    ).child(0);
    expect(plainItems(node)).toEqual(["one ", "two three", " four", 8, " five"]);
    expect(leafWords(node)).toBe(5);
    // "one " (4) + "two three" (9) + " four" (5) + footnote (8) + " five": five starts at 4 + 9 + 5 + 8 + 1.
    expect(wordOffset(node, 4)).toBe(27);
    expect(leafWordTexts(node)).toEqual([
      { text: "one", offset: 0 },
      { text: "two", offset: 4 },
      { text: "three", offset: 8 },
      { text: "four", offset: 14 },
      { text: "five", offset: 27 },
    ]);
  });

  it("counts the lines of a block of code and places each at its first character", () => {
    const node = doc({ type: "codeBlock", content: [t("a\nbb\n\nccc")] }).child(0);
    expect(leafWords(node)).toBe(4);
    expect([0, 1, 2, 3].map((w) => wordOffset(node, w))).toEqual([0, 2, 5, 6]);
    expect(wordOffset(node, 4)).toBeNull();
    expect(leafWordTexts(node)).toEqual([]);
  });

  it("has no words for a leaf that is no text", () => {
    expect(leafWords(doc({ type: "sceneBreak" }).child(0))).toBe(0);
  });
});

describe("docLeaves", () => {
  it("is one leaf for a paragraph, heading, scene break, image and code block, with the exporter's kind", () => {
    const d = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("A title")] },
      p(t("some words")),
      p(),
      p(t("  ")),
      p(t(" ", ["bold"])),
      { type: "sceneBreak" },
      { type: "image", attrs: { src: "assets/a.png" } },
      { type: "codeBlock", content: [t("x")] },
    );
    const leaves = docLeaves(d);
    expect(leaves.map((l) => l.map((x) => [x.kind, x.blank, x.words]))).toEqual([
      [["h", false, 2]],
      [["p", false, 2]],
      [["p", true, 0]],
      [["p", true, 0]],
      [["p", false, 0]],
      [["s", false, 0]],
      [["i", false, 0]],
      [["k", false, 1]],
    ]);
    expect(leaves[1]![0]!.pos).toBe(d.child(0).nodeSize);
    expect(isLeaf(d.child(1))).toBe(true);
  });

  it("takes the paragraphs inside quotes, lists and definition lists, in order", () => {
    const d = doc(
      { type: "blockquote", content: [p(t("q one")), p(t("q two"))] },
      ul(li(p(t("a")), ul(li(p(t("nested"))))), li(p(t("b")))),
      {
        type: "orderedList",
        content: [li(p(t("one")))],
      },
      {
        type: "definitionList",
        content: [
          { type: "definitionTerm", content: [t("Term")] },
          { type: "definitionDescription", content: [p(t("what it means"))] },
        ],
      },
    );
    const leaves = docLeaves(d);
    expect(leaves.map((l) => l.length)).toEqual([2, 3, 1, 2]);
    expect(leaves[1]!.map((l) => l.node.textContent)).toEqual(["a", "nested", "b"]);
    expect(leaves[3]!.map((l) => [l.kind, l.node.type.name])).toEqual([
      ["p", "definitionTerm"],
      ["p", "paragraph"],
    ]);
    // A leaf's pos is the position before it.
    for (const l of leaves.flat()) expect(d.nodeAt(l.pos)).toBe(l.node);
  });

  it("leaves out the header row of a table, which is repeated on every page and carries no marks", () => {
    const withHeader = doc(
      table(row("tableHeader", "H1", "H2"), row("tableCell", "a", "b"), row("tableCell", "c", "d")),
    );
    expect(docLeaves(withHeader)[0]!.map((l) => l.node.textContent)).toEqual(["a", "b", "c", "d"]);
    expect(hasHeaderRow(withHeader.child(0))).toBe(true);
    const plain = doc(table(row("tableCell", "a", "b"), row("tableCell", "c", "d")));
    expect(docLeaves(plain)[0]!.map((l) => l.node.textContent)).toEqual(["a", "b", "c", "d"]);
    expect(hasHeaderRow(plain.child(0))).toBe(false);
    expect(hasHeaderRow(doc(p(t("x"))).child(0))).toBe(false);
    // Only a row of header cells is a header row.
    expect(hasHeaderRow(doc(table(row("tableHeader", "H"), row("tableCell", "a"))).child(0))).toBe(
      true,
    );
    const mixed = doc(
      table({ type: "tableRow", content: [cell("tableHeader", "H"), cell("tableCell", "x")] }),
    );
    expect(hasHeaderRow(mixed.child(0))).toBe(false);
  });
});

describe("docLeaves in a table, and rowAround", () => {
  const d = doc(
    p(t("before")),
    table(
      row("tableHeader", "H1", "H2"),
      {
        type: "tableRow",
        content: [
          { type: "tableCell", content: [p(t("a1")), p(t("a2"))] },
          { type: "tableCell", content: [p(t("b"))] },
        ],
      },
      row("tableCell", "c", "d"),
    ),
  );

  it("numbers the row and the cell of every leaf in a body row (the header row has none), and no other leaf", () => {
    const leaves = docLeaves(d);
    expect(leaves[0]![0]!.cell).toBeUndefined();
    expect(leaves[1]!.map((l) => [l.node.textContent, l.cell])).toEqual([
      ["a1", { row: 1, cell: 0 }],
      ["a2", { row: 1, cell: 0 }],
      ["b", { row: 1, cell: 1 }],
      ["c", { row: 2, cell: 0 }],
      ["d", { row: 2, cell: 1 }],
    ]);
    // A list is no table: its leaves have no cell.
    expect(docLeaves(doc(ul(li(p(t("x"))))))[0]![0]!.cell).toBeUndefined();
  });

  it("gives the cell a leaf is in, its row, and the content of every cell of the row", () => {
    const leaves = docLeaves(d)[1]!;
    const a2 = rowAround(d, leaves[1]!.pos)!;
    const b = rowAround(d, leaves[2]!.pos)!;
    // Both are in the same row, in different cells.
    expect(a2.row).toEqual(b.row);
    expect(a2.row.cells).toHaveLength(2);
    expect(a2.cell).toEqual(a2.row.cells[0]);
    expect(b.cell).toEqual(a2.row.cells[1]);
    // A cell's content is its paragraphs; the row is the node itself.
    expect(d.textBetween(a2.cell.from, a2.cell.to, "|")).toBe("a1|a2");
    expect(d.nodeAt(a2.row.from)?.type.name).toBe("tableRow");
    expect(a2.row.to).toBe(a2.row.from + d.nodeAt(a2.row.from)!.nodeSize);
    // Outside a row: no answer.
    expect(rowAround(d, 0)).toBeNull();
    expect(rowAround(doc(ul(li(p(t("x"))))), 3)).toBeNull();
  });
});

describe("pageStartAt", () => {
  const at = (d: PMNode, block: number, leaf: number) =>
    pageStartAt(d, docLeaves(d)[block]![leaf]!.pos);

  it("is the block itself for the first leaf of a block", () => {
    const d = doc(p(t("x")), ul(li(p(t("a"))), li(p(t("b")))));
    expect(at(d, 0, 0)).toEqual({ pos: 0, top: true });
    expect(at(d, 1, 0)).toEqual({ pos: d.child(0).nodeSize, top: true });
  });

  it("is the list item, not the paragraph in it, and the nested list when it starts the item", () => {
    const d = doc(ul(li(p(t("a")), ul(li(p(t("n1"))), li(p(t("n2"))))), li(p(t("b")))));
    const list = d.child(0);
    const first = list.child(0);
    // The second top-level item.
    expect(at(d, 0, 3)).toEqual({ pos: 1 + first.nodeSize, top: false });
    // The second paragraph of an item is itself.
    const two = doc(ul(li(p(t("a")), p(t("a2")))));
    expect(at(two, 0, 1)).toEqual({
      pos: 1 + 1 + two.child(0).child(0).child(0).nodeSize,
      top: false,
    });
    // A nested list that starts an item: the nested list (the item itself starts with the outer paragraph only when it is first).
    const nested = doc(ul(li(p(t("a"))), li(ul(li(p(t("deep")))), p(t("after")))));
    const pos = at(nested, 0, 1)!;
    expect(pos.top).toBe(false);
    expect(nested.nodeAt(pos.pos)?.type.name).toBe("listItem");
  });

  it("is the table row, and the whole table when the first data row starts it", () => {
    const d = doc(
      table(row("tableHeader", "H1", "H2"), row("tableCell", "a", "b"), row("tableCell", "c", "d")),
    );
    // Leaves: a, b, c, d. The first data row starts the table (the header is its first row).
    expect(at(d, 0, 0)).toEqual({ pos: 0, top: true });
    const third = at(d, 0, 2)!;
    expect(d.nodeAt(third.pos)?.type.name).toBe("tableRow");
    expect(third.top).toBe(false);
  });

  it("cannot draw a page that begins inside a table row", () => {
    const d = doc(table(row("tableCell", "a", "b"), row("tableCell", "c", "d")));
    expect(at(d, 0, 1)).toBeNull();
    expect(at(d, 0, 3)).toBeNull();
    const two = doc(
      table({
        type: "tableRow",
        content: [{ type: "tableCell", content: [p(t("x")), p(t("y"))] }],
      }),
    );
    expect(at(two, 0, 1)).toBeNull();
    expect(insideCell(two, docLeaves(two)[0]![1]!.pos)).toBe(true);
    expect(insideCell(doc(p(t("x"))), 1)).toBe(false);
  });

  it("is the paragraph of a quote", () => {
    const d = doc({ type: "blockquote", content: [p(t("one")), p(t("two"))] });
    expect(at(d, 0, 0)).toEqual({ pos: 0, top: true });
    expect(at(d, 0, 1)).toEqual({ pos: 1 + d.child(0).child(0).nodeSize, top: false });
  });
});

describe("wordsFrom", () => {
  const d = doc(
    p(t("one two")),
    { type: "codeBlock", content: [t("let  x = 1")] },
    table(row("tableHeader", "head"), row("tableCell", "cell words")),
    { type: "sceneBreak" },
    p(t("last")),
  );
  const texts = (from: number, limit: number) => wordsFrom(d, from, limit).map((w) => w.text);

  it("lists the words of the chapter in order, those of code by spaces and none of a header row", () => {
    expect(texts(0, 100)).toEqual(["one", "two", "let", "x", "=", "1", "cell", "words", "last"]);
  });

  it("gives the positions the words start at and skips what is before `from`", () => {
    const all = wordsFrom(d, 0, 100);
    expect(all[0]!.pos).toBe(1);
    expect(all[1]!.pos).toBe(5);
    // from inside the first word: the next one is the first
    expect(texts(3, 2)).toEqual(["two", "let"]);
    // after the first paragraph entirely
    expect(texts(d.child(0).nodeSize, 1)).toEqual(["let"]);
  });

  it("stops at the limit", () => {
    expect(texts(0, 3)).toEqual(["one", "two", "let"]);
    expect(texts(d.content.size, 5)).toEqual([]);
  });
});

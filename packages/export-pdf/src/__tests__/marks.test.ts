// Page marks (`blockMarks`) without typst: the source that carries them and the parsing of what Typst reports.
import { describe, expect, it } from "vitest";
import type { DocNode, Mark } from "@cadabracraft/shared";
import { parsePageReport } from "../measure";
import { buildTypst } from "../typst";
import { markedBlocks, plainItems } from "../typst/blocks";
import type { PdfChapter } from "../types";

const book = { title: "B", author: "A", language: "en" };
const t = (text: string, marks?: Mark[]): DocNode => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const chapter = (...content: object[]): PdfChapter => ({
  id: "c1",
  title: "One",
  doc: { type: "doc", content } as PdfChapter["doc"],
});
const marked = (c: PdfChapter, options = {}) =>
  buildTypst(book, [c], { blockMarks: true, template: "nonfiction", ...options });

describe("page marks in the source", () => {
  it("adds none unless asked", () => {
    const src = buildTypst(book, [chapter({ type: "paragraph", content: [t("one two")] })]);
    expect(src).not.toContain("bm-s");
    expect(src).not.toContain("#wm(");
    expect(src).not.toContain("marks: marks");
  });

  it("marks each block's start with its index and kind, and each word of an ordinary paragraph but the first", () => {
    const src = marked(
      chapter(
        { type: "heading", attrs: { level: 1 }, content: [t("Title")] },
        { type: "paragraph", content: [t("one two  three")] },
        { type: "paragraph", content: [] },
        { type: "sceneBreak" },
        { type: "blockquote", content: [{ type: "paragraph", content: [t("q")] }] },
      ),
    );
    expect(src).toContain('#heading(level: 1)[#bm-s(0, 0, "h")Title]');
    expect(src).toContain('#bm-s(0, 1, "p")one #wm(1)two  #wm(2)three');
    expect(src).toContain('#bm-s(0, 3, "s")\n\n#scene-break()');
    expect(src).toContain('#bm-s(0, 4, "o")\n\n#quote(block: true)');
    expect(src).not.toContain("bm-s(0, 2");
    expect(src).toContain("#let wm(w)");
    expect(src).toContain("query(<bm>)");
  });

  it("splits text nodes at word starts, wraps marks around the pieces and escapes after a mark", () => {
    const src = marked(
      chapter({
        type: "paragraph",
        content: [t("a (b) "), t("bold .x", [{ type: "bold" }]), { type: "hardBreak" }, t("= c")],
      }),
    );
    expect(src).toContain(
      '#bm-s(0, 0, "p")a #wm(1)\\(b) #strong[#wm(2)bold #wm(3)\\.x]\\\n#wm(4)\\= #wm(5)c',
    );
  });

  it("copes with blocks that have no content at all", () => {
    expect(plainItems(undefined)).toEqual([]);
    expect(
      markedBlocks(undefined, { images: new Map(), maxImageIn: 1, assets: undefined }, 0),
    ).toBe("");
    expect(marked(chapter({ type: "heading", attrs: { level: 2 } }))).toContain(
      '#heading(level: 2)[#bm-s(0, 0, "h")]',
    );
    expect(buildTypst(book, [chapter({ type: "taskList" })])).toContain("#enum(");
  });

  it("marks a paragraph with a footnote or code as one piece", () => {
    expect(plainItems([t("a b"), { type: "hardBreak" }])).toEqual(["a b", null]);
    expect(plainItems([t("a", [{ type: "code" }])])).toBeNull();
    expect(plainItems([t("a"), { type: "footnote", content: [] }])).toBeNull();
    const src = marked(
      chapter({ type: "paragraph", content: [t("one two"), { type: "footnote", content: [] }] }),
    );
    expect(src).toContain('#bm-s(0, 0, "q")one two#footnote[');
    expect(src).not.toContain("#wm(");
  });

  it("marks the drop cap paragraph as one piece around the drop cap and the paragraphs after it", () => {
    const src = marked(
      chapter(
        { type: "paragraph", content: [t("Once upon a time")] },
        { type: "paragraph", content: [t("then more")] },
      ),
      { template: "novel" },
    );
    expect(src).toContain('#bm-s(0, 0, "q")\n\n#dropcap(');
    expect(src).toContain('#bm-s(0, 1, "p")then #wm(1)more');
  });
});

describe("parsePageReport marks", () => {
  const starts = [
    { id: "a", kind: "chapter", page: 1, end: 3, number: "1" },
    { id: "b", kind: "chapter", page: 4, end: 4, number: "4" },
  ];
  const parse = (marks: unknown[]) =>
    parsePageReport(JSON.stringify({ total: 4, starts, marks })).blocks;

  it("groups blocks by entry; a word mark that opens a page puts the split one word earlier", () => {
    expect(
      parse([
        ["s", 0, 0, "h", 1],
        ["s", 0, 1, "p", 1],
        ["w", 31, 2],
        ["w", 60, 3],
        ["s", 1, 0, "o", 4],
      ]),
    ).toEqual({
      a: [
        { block: 0, kind: "h", page: 1, splits: [] },
        {
          block: 1,
          kind: "p",
          page: 1,
          splits: [
            { word: 30, page: 2 },
            { word: 59, page: 3 },
          ],
        },
      ],
      b: [{ block: 0, kind: "o", page: 4, splits: [] }],
    });
  });

  it("has no blocks without marks, and drops marks that make no sense", () => {
    expect(parse([])).toBeUndefined();
    for (const bad of [
      [["w", 3, 2]],
      [["s", 5, 0, "p", 1]],
      [["s", "x", 0, "p", 1]],
      [["s", 0, 0, "z", 1]],
      [
        ["s", 0, 0, "p", 1],
        ["w", 0, 2],
      ],
      [["s", 0, 0, "p", 1], ["x"]],
      ["s"],
    ])
      expect(parse(bad)).toBeUndefined();
  });
});

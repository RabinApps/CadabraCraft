// Page marks (`blockMarks`) without typst: the source that carries them and the parsing of what Typst reports.
import { describe, expect, it } from "vitest";
import type { DocNode, Mark } from "@cadabracraft/shared";
import { parsePageReport } from "../measure";
import { buildTypst } from "../typst";
import { markedBlocks, plainItems } from "../typst/blocks";
import { nodeSize } from "../typst/inline";
import type { PdfChapter } from "../types";

const book = { title: "B", author: "A", language: "en" };
const t = (text: string, marks?: Mark[]): DocNode => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const p = (...kids: DocNode[]): object => ({ type: "paragraph", content: kids });
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

  it("marks each leaf's start with its block's index and kind, and each word of a paragraph or heading but the first", () => {
    const src = marked(
      chapter(
        { type: "heading", attrs: { level: 1 }, content: [t("Title")] },
        { type: "paragraph", content: [t("one two  three")] },
        { type: "paragraph", content: [] },
        { type: "sceneBreak" },
        { type: "heading", attrs: { level: 2 }, content: [t("Two words")] },
        { type: "image", attrs: { src: "assets/a.png" } },
      ),
      { assets: { "assets/a.png": new Uint8Array([1]) } },
    );
    expect(src).toContain('#heading(level: 1)[#bm-s(0, 0, "h")Title]');
    expect(src).toContain('#bm-s(0, 1, "p")one #wm(1)two  #wm(2)three');
    expect(src).toContain('#bm-s(0, 3, "s")\n\n#scene-break()');
    expect(src).toContain('#heading(level: 2)[#bm-s(0, 4, "h")Two #wm(1)words]');
    expect(src).toContain('#bm-s(0, 5, "i")\n\n#figure(');
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
      markedBlocks(
        undefined,
        { images: new Map(), headingNo: 0, maxImageIn: 1, assets: undefined, coverAlt: "Cover" },
        0,
      ),
    ).toBe("");
    expect(marked(chapter({ type: "heading", attrs: { level: 2 } }))).toContain(
      '#heading(level: 2)[#bm-s(0, 0, "h")]',
    );
    expect(buildTypst(book, [chapter({ type: "taskList" })])).toContain("#enum(");
  });

  it("marks the words of a paragraph with a footnote or inline code, one raw per piece of code", () => {
    expect(plainItems([t("a b"), { type: "hardBreak" }])).toEqual(["a b", null]);
    expect(plainItems([t("a"), { type: "footnote", content: [t("note")] }])).toEqual(["a", 6]);
    expect(nodeSize({ type: "footnote", content: [t("note")] })).toBe(6);
    expect(nodeSize({ type: "sceneBreak" })).toBe(1);
    expect(nodeSize({ type: "footnote" })).toBe(1);
    const src = marked(
      chapter({
        type: "paragraph",
        content: [
          t("one "),
          t("two three", [{ type: "code" }]),
          { type: "footnote", content: [t("a note")] },
          t(" four five"),
          t("x y", [{ type: "code" }]),
        ],
      }),
    );
    // The footnote takes 8 positions and is part of no word.
    expect(src).toContain(
      '#bm-s(0, 0, "p")one #wm(1)#raw("two ")#wm(2)#raw("three")#footnote[a note] #wm(3)four #wm(4)five#raw("x ")#wm(5)#raw("y")',
    );
    // Code that starts a paragraph or a word of its own gets no empty piece.
    const lone = marked(chapter({ type: "paragraph", content: [t("a b", [{ type: "code" }])] }));
    expect(lone).toContain('#bm-s(0, 0, "p")#raw("a ")#wm(1)#raw("b")');
    const afterBreak = marked(
      chapter({ type: "paragraph", content: [t("x "), t("y z", [{ type: "code" }])] }),
    );
    expect(afterBreak).toContain('x #wm(1)#raw("y ")#wm(2)#raw("z")');
    expect(
      marked(chapter({ type: "paragraph", content: [t("a"), t(" b", [{ type: "code" }])] })),
    ).toContain('#raw(" ")#wm(1)#raw("b")');
  });

  it("marks inside the words it is asked to take apart instead of before the words (the second run of a measure)", () => {
    const src = marked(
      chapter(
        p(t("one internal two")),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [p(t("a b"), t("cdef", [{ type: "bold" }]))] }],
        },
        p(t("x "), t("code word", [{ type: "code" }])),
      ),
      {
        charMarks: [
          { chapter: 0, block: 0, leaf: 0, word: 1 },
          { chapter: 0, block: 0, leaf: 0, word: 2 },
          { chapter: 0, block: 1, leaf: 0, word: 1 },
          { chapter: 0, block: 2, leaf: 0, word: 2 },
        ],
      },
    );
    // Only the leaves and words asked for; no mark before a word. A word that goes on in another text node is marked as far as the node goes.
    expect(src).toContain(
      '#bm-s(0, 0, "p")one i#cm(0, 0, 0, 1, 1)n#cm(0, 0, 0, 1, 2)t#cm(0, 0, 0, 1, 3)e#cm(0, 0, 0, 1, 4)r#cm(0, 0, 0, 1, 5)n#cm(0, 0, 0, 1, 6)a#cm(0, 0, 0, 1, 7)l t#cm(0, 0, 0, 2, 1)w#cm(0, 0, 0, 2, 2)o',
    );
    expect(src).toContain('#bm-s(0, 1, "p")a b#strong[cdef]');
    // A leaf it does not ask for has no word marks at all.
    expect(
      marked(chapter(p(t("one two three"))), {
        charMarks: [{ chapter: 0, block: 5, leaf: 0, word: 1 }],
      }),
    ).toContain('#bm-s(0, 0, "p")one two three');
    expect(src).toContain(
      '#bm-s(0, 2, "p")x #raw("code w")#cm(0, 2, 0, 2, 1)#raw("o")#cm(0, 2, 0, 2, 2)#raw("r")#cm(0, 2, 0, 2, 3)#raw("d")',
    );
    expect(src).not.toContain("#wm(");
    expect(src).toContain("#let cm(c, b, l, w, j)");
  });

  it("marks the paragraphs inside quotes, lists, tables and definition lists as leaves of their block", () => {
    const li = (...c: object[]) => ({ type: "listItem", content: c });
    const row = (kind: string, ...cells: string[]) => ({
      type: "tableRow",
      content: cells.map((x) => ({ type: kind, content: [p(t(x))] })),
    });
    const src = marked(
      chapter(
        { type: "blockquote", content: [p(t("q one")), p(t("q two"))] },
        { type: "bulletList", content: [li(p(t("a b")), p(t("c"))), li(p(t("d")))] },
        { type: "orderedList", attrs: { start: 3 }, content: [li(p(t("e")))] },
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("f"))] }],
        },
        {
          type: "table",
          content: [row("tableHeader", "H1", "H2"), row("tableCell", "x", "y")],
        },
        {
          type: "definitionList",
          content: [
            { type: "definitionTerm", content: [t("Term here")] },
            { type: "definitionDescription", content: [p(t("what"))] },
          ],
        },
      ),
    );
    expect(src).toContain(
      '#quote(block: true)[\n#bm-s(0, 0, "p")q #wm(1)one\n\n#bm-s(0, 0, "p")q #wm(1)two\n]',
    );
    expect(src).toContain('#bm-s(0, 1, "p")a #wm(1)b\n\n#bm-s(0, 1, "p")c');
    expect(src).toContain('#bm-s(0, 1, "p")d');
    expect(src).toContain('#bm-s(0, 2, "p")e');
    expect(src).toContain('#bm-s(0, 3, "p")f');
    // A table's header row is repeated on every page, and so would be its marks: it has none.
    expect(src).toContain("table.header([H1], [H2])");
    expect(src).toContain('[#bm-s(0, 4, "p")x], [#bm-s(0, 4, "p")y]');
    expect(src).toContain('#def-term[#bm-s(0, 5, "p")Term #wm(1)here]');
    expect(src).toContain('#def-desc[\n#bm-s(0, 5, "p")what\n]');
    // The marks are off again after the last block.
    expect(src.match(/#bm-s\(/g)).toHaveLength(11);
  });

  it("marks a block of code line by line", () => {
    const src = marked(chapter({ type: "codeBlock", content: [t("a\nb")] }));
    expect(src).toContain(
      '#bm-s(0, 0, "k")\n\n#[#show raw.line: bm-line\n#raw(block: true, "a\\nb")]',
    );
    expect(src).toContain('#let bm-line(it) = [#metadata(("l", it.number))<bm>#it]');
    expect(buildTypst(book, [chapter({ type: "codeBlock", content: [t("a")] })])).toContain(
      '#raw(block: true, "a")',
    );
  });

  it("marks front and back matter like chapters", () => {
    const src = buildTypst(
      book,
      [
        {
          id: "t",
          title: "T",
          section: "front",
          kind: "title-page",
          doc: { type: "doc", content: [p(t("Hello world")) as DocNode] },
        },
        {
          id: "p",
          title: "P",
          section: "front",
          kind: "preface",
          doc: { type: "doc", content: [p(t("Words here")) as DocNode] },
        },
        { id: "c", title: "C", doc: { type: "doc", content: [p(t("Body text")) as DocNode] } },
        {
          id: "a",
          title: "A",
          section: "back",
          kind: "acknowledgments",
          doc: { type: "doc", content: [p(t("More words")) as DocNode] },
        },
      ],
      { blockMarks: true, template: "nonfiction" },
    );
    expect(src).toContain('#bm-s(0, 0, "p")Hello #wm(1)world');
    expect(src).toContain('#bm-s(1, 0, "p")Words #wm(1)here');
    expect(src).toContain('#bm-s(2, 0, "p")Body #wm(1)text');
    expect(src).toContain('#bm-s(3, 0, "p")More #wm(1)words');
  });

  it("marks the words of the drop cap paragraph and the paragraphs after it", () => {
    const src = marked(
      chapter(
        { type: "paragraph", content: [t("Once upon a time")] },
        { type: "paragraph", content: [t("then more")] },
      ),
      { template: "novel" },
    );
    expect(src).toContain(
      '#bm-s(0, 0, "p")\n\n#dropcap(height: 3, gap: 0.12em)[Once #wm(1)upon #wm(2)a #wm(3)time]',
    );
    expect(src).toContain('#bm-s(0, 1, "p")then #wm(1)more');
    // Without marks the drop cap is the same call with the plain text.
    expect(
      buildTypst(book, [chapter({ type: "paragraph", content: [t("Once upon")] })], {
        template: "novel",
      }),
    ).toContain("#dropcap(height: 3, gap: 0.12em)[Once upon]");
  });
});

describe("parsePageReport marks", () => {
  const starts = [
    { id: "a", kind: "chapter", page: 1, end: 3, number: "1" },
    { id: "b", kind: "chapter", page: 4, end: 4, number: "4" },
  ];
  const parse = (marks: unknown[]) =>
    parsePageReport(JSON.stringify({ total: 4, starts, marks })).blocks;

  it("groups leaves by entry and counts a block's leaves; a word mark that opens a page puts the split one word earlier", () => {
    expect(
      parse([
        ["s", 0, 0, "h", 1],
        ["s", 0, 1, "p", 1],
        ["w", 31, 2],
        ["w", 60, 3],
        ["s", 0, 2, "p", 3],
        ["s", 0, 2, "p", 3],
        ["s", 0, 3, "i", 3],
        ["s", 1, 0, "s", 4],
      ]),
    ).toEqual({
      a: [
        { block: 0, leaf: 0, kind: "h", page: 1, splits: [] },
        {
          block: 1,
          leaf: 0,
          kind: "p",
          page: 1,
          splits: [
            { word: 30, page: 2 },
            { word: 59, page: 3 },
          ],
        },
        { block: 2, leaf: 0, kind: "p", page: 3, splits: [] },
        { block: 2, leaf: 1, kind: "p", page: 3, splits: [] },
        { block: 3, leaf: 0, kind: "i", page: 3, splits: [] },
      ],
      b: [{ block: 0, leaf: 0, kind: "s", page: 4, splits: [] }],
    });
  });

  it("reads a line mark of a block of code like a word mark, counting lines from 1", () => {
    expect(
      parse([
        ["s", 0, 0, "k", 1],
        ["l", 31, 2],
        ["l", 72, 3],
      ]),
    ).toEqual({
      a: [
        {
          block: 0,
          leaf: 0,
          kind: "k",
          page: 1,
          splits: [
            { word: 29, page: 2 },
            { word: 70, page: 3 },
          ],
        },
      ],
    });
  });

  it("has no blocks without marks, and drops marks that make no sense", () => {
    expect(parse([])).toBeUndefined();
    for (const bad of [
      [["w", 3, 2]],
      [["s", 5, 0, "p", 1]],
      [["s", "x", 0, "p", 1]],
      [["s", 0, 0, "z", 1]],
      [["s", 0, 0, "o", 1]],
      [["s", 0, 0, "q", 1]],
      [
        ["s", 0, 0, "p", 1],
        ["w", 0, 2],
      ],
      [
        ["s", 0, 0, "k", 1],
        ["l", 1, 2],
      ],
      [["l", 4, 2]],
      [["s", 0, 0, "p", 1], ["x"]],
      ["s"],
    ])
      expect(parse(bad)).toBeUndefined();
  });
});

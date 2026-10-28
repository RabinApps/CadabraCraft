import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { MarkdownExportError, chapterToMarkdown, chaptersToMarkdown } from "../index";

const t = (text: string, ...marks: Mark[]): DocNode =>
  marks.length ? { type: "text", text, marks } : { type: "text", text };
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const md = (...content: DocNode[]): string => chapterToMarkdown(doc(...content));
const bare = (type: string, attrs?: Record<string, string | number | null>): DocNode =>
  (attrs ? { type, attrs } : { type }) as DocNode;
const row = (...cells: DocNode[]): DocNode => ({ type: "tableRow", content: cells });
const cell = (...content: DocNode[]): DocNode => ({ type: "tableCell", content });
const header = (...content: DocNode[]): DocNode => ({ type: "tableHeader", content });
const table = (...rows: DocNode[]): DocNode => ({ type: "table", content: rows });
const image = (attrs?: Record<string, string | null>): DocNode => bare("image", attrs);
const item = (...content: DocNode[]): DocNode => ({ type: "listItem", content });

describe("unknown content throws instead of being dropped", () => {
  it.each([
    ["a block", () => md(bare("mystery")), /Unsupported node type in chapter: mystery/],
    ["an inline node", () => md(p(bare("emoji"))), /inline content: emoji/],
    [
      "a mark",
      () => md(p({ type: "text", text: "x", marks: [{ type: "glow" }] } as never)),
      /Unsupported mark type in chapter: glow/,
    ],
    [
      "a node in a code block",
      () => md({ type: "codeBlock", content: [bare("hardBreak")] }),
      /code block: hardBreak/,
    ],
    [
      "a node in a list",
      () => md({ type: "bulletList", content: [p(t("x"))] }),
      /in a list: paragraph/,
    ],
    ["a node in a table", () => md(table(p(t("x")))), /in table: paragraph/],
    ["a node in a table row", () => md(table(row(p(t("x"))))), /in table row: paragraph/],
    [
      "a node in a table cell",
      () => md(table(row(cell(bare("sceneBreak"))))),
      /table cell: sceneBreak/,
    ],
  ])("%s", (_name, run, message) => {
    expect(run).toThrow(MarkdownExportError);
    expect(run).toThrow(message);
  });
  it.each([
    ["not an object", undefined],
    ["a wrong type", { type: "paragraph" }],
    ["without content", { type: "doc" }],
  ])("refuses a chapter document that is %s", (_name, bad) => {
    expect(() => chapterToMarkdown(bad as never)).toThrow(/must be an object with type "doc"/);
  });
});

describe("code blocks", () => {
  it("writes an empty block, a language and a longer fence", () => {
    expect(md(bare("codeBlock", { language: "js" }))).toBe("```js\n```\n");
    expect(md({ type: "codeBlock", content: [t("a ``` b")] })).toBe("````\na ``` b\n````\n");
    expect(md({ type: "codeBlock", attrs: { language: null }, content: [t("x")] })).toBe(
      "```\nx\n```\n",
    );
  });
  it("refuses a language that is not a string or cannot sit in a fence", () => {
    expect(() => md(bare("codeBlock", { language: 5 }))).toThrow(/must be a string/);
    expect(() => md(bare("codeBlock", { language: "a b" }))).toThrow(
      /cannot be written in a fence/,
    );
    expect(() => md(bare("codeBlock", { language: "a`" }))).toThrow(/cannot be written in a fence/);
  });
});

describe("images", () => {
  it("writes relative sources with the base and absolute ones without", () => {
    expect(
      chapterToMarkdown(doc(image({ src: "assets/a b(1).png", alt: "A" })), { imageBase: "../" }),
    ).toBe("![A](../assets/a%20b%281%29.png)\n");
    expect(md(image({ src: "https://x.test/a.png", alt: "A", title: 'T "q"' }))).toBe(
      '![A](https://x.test/a.png "T \\"q\\"")\n',
    );
    expect(md(image({ src: "/abs.png" }))).toBe("![](/abs.png)\n");
  });
  it("refuses an image without a source, or with ? or # in the path", () => {
    expect(() => md(image())).toThrow(/without a source/);
    expect(() => md(image({ src: "assets/a?b.png" }))).toThrow(/query or fragment/);
    expect(() => md(image({ src: "assets/a#b.png" }))).toThrow(/query or fragment/);
  });
});

describe("tables", () => {
  it("refuses malformed tables", () => {
    expect(() => md(bare("table"))).toThrow(/without rows/);
    expect(() => md(table(bare("tableRow")))).toThrow(/non-zero number of cells/);
    expect(() => md(table(row(cell()), row(cell(), cell())))).toThrow(/same, non-zero/);
  });
  it("writes a cell without content as empty", () => {
    expect(md(table(row(bare("tableCell"))))).toBe("|  |\n| --- |\n|  |\n");
  });
  it("writes a header row, or an empty header when there is none, and joins cell paragraphs", () => {
    expect(md(table(row(header(p(t("H")))), row(cell(p(t("a")), p(), p(t("b"))))))).toBe(
      "| H |\n| --- |\n| a b |\n",
    );
    expect(md(table(row(cell()), row(cell(bare("paragraph")))))).toBe(
      "|  |\n| --- |\n|  |\n|  |\n",
    );
  });
});

describe("lists and blocks", () => {
  it("writes an empty list, empty items and a list without items", () => {
    expect(md(bare("bulletList"))).toBe("");
    expect(md({ type: "bulletList", content: [item(), item(p(t("x")))] })).toBe("-\n- x\n");
  });
  it("falls back to start 1 for a bad start and keeps a valid one", () => {
    const ol = (start: number): DocNode => ({
      type: "orderedList",
      attrs: { start },
      content: [item(p(t("x")))],
    });
    expect(md(ol(1.5))).toBe("1. x\n");
    expect(md(ol(1_000_000_000))).toBe("1. x\n");
    expect(md(ol(7))).toBe("7. x\n");
  });
  it("alternates markers for adjacent lists and keeps nested lists tight, code blocks loose", () => {
    const ul: DocNode = { type: "bulletList", content: [item(p(t("x")))] };
    expect(md(ul, ul, p(t("gap")), ul)).toBe("- x\n\n* x\n\ngap\n\n- x\n");
    expect(md({ type: "bulletList", content: [item(p(t("a")), ul)] })).toBe("- a\n  - x\n");
    expect(
      md({
        type: "bulletList",
        content: [item(p(t("a")), { type: "codeBlock", content: [t("c")] })],
      }),
    ).toBe("- a\n\n  ```\n  c\n  ```\n");
  });
  it("writes headings and block quotes", () => {
    expect(md(bare("heading"))).toBe("#\n");
    expect(md({ type: "heading", content: [t("Hi")] })).toBe("# Hi\n");
    expect(md({ type: "heading", attrs: { level: 2 }, content: [t("a #")] })).toBe("## a \\#\n");
    expect(() => md({ type: "heading", attrs: { level: 4 }, content: [t("x")] })).toThrow(
      /level 4/,
    );
    expect(md(bare("blockquote"))).toBe(">\n");
    expect(md({ type: "blockquote", content: [p(t("a")), p(t("b"))] })).toBe("> a\n>\n> b\n");
  });
  it("leaves out an empty page", () => {
    expect(chapterToMarkdown(doc())).toBe("");
    expect(md(p())).toBe("");
  });
});

describe("marks", () => {
  it("requires htmlMarks for marks without Markdown syntax, and a link href", () => {
    expect(() => md(p(t("x", { type: "underline" })))).toThrow(/htmlMarks/);
    expect(() => md(p(t("x", { type: "link" })))).toThrow(/without an href/);
  });
  it("collapses a repeated mark and keeps a whitespace-only run unmarked", () => {
    expect(md(p(t("x", { type: "bold" }, { type: "bold" })))).toBe("**x**\n");
    expect(md(p(t("a"), t(" ", { type: "bold" }), t("b")))).toBe("a b\n");
  });
  it("writes every mark, nesting links outermost and escaping a '!' before a link", () => {
    const link: Mark = { type: "link", attrs: { href: "https://e.test" } };
    expect(md(p(t("a!"), t("b", link)))).toBe("a\\![b](https://e.test)\n");
    expect(
      chapterToMarkdown(
        doc(
          p(
            t("u", { type: "underline" }),
            t("c", { type: "smallCaps" }),
            t("s", { type: "superscript" }),
            t("b", { type: "subscript" }),
            t("k", { type: "strike" }),
            t("x", { type: "code" }),
          ),
        ),
        { htmlMarks: true },
      ),
    ).toBe('<u>u</u><span class="small-caps">c</span><sup>s</sup><sub>b</sub>~~k~~`x`\n');
  });
  it("uses underscores for italic next to bold, italic or an asterisk", () => {
    expect(md(p(t("a", { type: "italic" }), t("b", { type: "bold" })))).toBe("_a_**b**\n");
    expect(md(p(t("a", { type: "italic" }), t("b", { type: "italic", attrs: undefined })))).toBe(
      "*ab*\n",
    );
    expect(md(p(t("a", { type: "bold" }), t("b", { type: "italic" })))).toBe("**a**_b_\n");
    expect(md(p(t("a", { type: "italic" }), t("b")))).toBe("*a*b\n");
  });
});

describe("inline nodes", () => {
  it("writes hard breaks and footnotes with offsets", () => {
    expect(md(p(t("a"), bare("hardBreak"), t("b")))).toBe("a\\\nb\n");
    const fn: DocNode = { type: "footnote", content: [t("note")] };
    expect(chapterToMarkdown(doc(p(t("x"), fn)), { footnoteOffset: 4 })).toBe(
      "x[^5]\n\n[^5]: note\n",
    );
  });
  it("escapes block markers at the start of the line after a hard break", () => {
    const br = bare("hardBreak");
    expect(md(p(t("a"), br, t("# h"), br, t("- b"), br, t("1. c"), br, t("+ d")))).toBe(
      "a\\\n\\# h\\\n\\- b\\\n1\\. c\\\n\\+ d\n",
    );
    // a line of "=" would turn the previous line into a setext heading
    expect(md(p(t("a"), br, t("===")))).toBe("a\\\n\\===\n");
    // a footnote reference is not text, so the next text is still escaped; bold text hides the marker
    expect(md(p(t("a"), br, t("x", { type: "bold" }), br, t("- y")))).toBe("a\\\n**x**\\\n\\- y\n");
    // text after a non-break item is not at a line start
    expect(md(p(t("a"), br, { type: "footnote", content: [t("n")] }, t("- b")))).toBe(
      "a\\\n[^1]- b\n\n[^1]: n\n",
    );
  });
  it("drops trailing hard breaks, which would end the block with a literal backslash", () => {
    const br = bare("hardBreak");
    expect(md(p(t("a"), br))).toBe("a\n");
    expect(md(p(t("a"), br, br))).toBe("a\n");
    expect(md(p(br, t("b")))).toBe("\\\nb\n");
  });
  it("refuses line feeds in text, a hard break where it cannot be written and nested footnotes", () => {
    expect(() => md(p(t("a\nb")))).toThrow(/line break/);
    expect(() => md(p({ type: "footnote", content: [bare("hardBreak")] }))).toThrow(/hard break/);
    expect(() => md(p({ type: "footnote", content: [{ type: "footnote", content: [] }] }))).toThrow(
      /another footnote/,
    );
  });
  it("skips empty text and tolerates missing inline content", () => {
    expect(md(p(t("")), bare("heading"))).toBe("#\n");
    expect(md(bare("paragraph"))).toBe("");
  });
});

describe("pages", () => {
  it("adds a title heading unless the page starts with one or has no title, continuing footnotes", () => {
    const fn: DocNode = { type: "footnote", content: [t("n")] };
    const out = chaptersToMarkdown({ title: "B" }, [
      { title: "One", doc: doc(p(t("a"), fn)) },
      { title: "  ", doc: doc(p(t("b"), fn)) },
      { title: "Three", doc: doc({ type: "heading", attrs: { level: 1 }, content: [t("Own")] }) },
      { title: "Intro", section: "front", doc: doc(p(t("f"))) },
    ]);
    expect(out[0]).toBe("# Intro\n\nf\n");
    expect(out[1]).toContain("[^1]: n");
    expect(out[2]).toContain("[^2]: n");
    expect(out[3]).toBe("# Own\n");
  });
});

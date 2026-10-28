import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import {
  ImportError,
  htmlToBlocks,
  htmlToInline,
  importHtml,
  looksLikeHtml,
  type ImportResult,
} from "..";
import { expectValid } from "./helpers";

const blocks = (html: string) => htmlToBlocks(html).blocks;
const text = (n: unknown) => JSON.stringify(n);
const validate = (b: DocNode[]) =>
  expectValid({
    chapters: [{ title: "t", doc: { type: "doc", content: b } }],
    warnings: [],
    assets: [],
  } as ImportResult);
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const t = (s: string, ...marks: string[]): DocNode =>
  marks.length
    ? ({ type: "text", text: s, marks: marks.map((type) => ({ type })) } as DocNode)
    : { type: "text", text: s };

describe("htmlToBlocks mappings", () => {
  it("maps paragraphs, headings (clamped to 3) and scene breaks", () => {
    const r = htmlToBlocks(
      "<h1>A</h1><h2>B</h2><h5>C</h5><p>one</p><hr><hr class='scene-break'><p>two</p>",
    );
    expect(r.blocks.map((b) => b.type)).toEqual([
      "heading",
      "heading",
      "heading",
      "paragraph",
      "sceneBreak",
      "sceneBreak",
      "paragraph",
    ]);
    expect((r.blocks[2] as unknown as { attrs: { level: number } }).attrs.level).toBe(3);
    expect(r.warnings.map((w) => w.code)).toEqual(["heading-clamped"]);
    validate(r.blocks);
  });

  it("maps every inline mark", () => {
    const b = blocks(
      "<p><strong>a</strong><b>b</b><em>c</em><i>d</i><u>e</u><s>f</s><del>g</del><strike>h</strike><code>i</code><sup>j</sup><sub>k</sub></p>",
    );
    expect(b[0]).toEqual(
      p(
        t("ab", "bold"),
        t("cd", "italic"),
        t("e", "underline"),
        t("fgh", "strike"),
        t("i", "code"),
        t("j", "superscript"),
        t("k", "subscript"),
      ),
    );
    validate(b);
  });

  it("small caps from class and from inline style, footnotes from span.footnote", () => {
    const b = blocks(
      '<p><span class="small-caps">a</span><span style="font-variant: small-caps">b</span> c<span class="footnote">  note  text </span></p>',
    );
    expect(b[0]).toEqual(
      p(t("ab", "smallCaps"), t(" c"), { type: "footnote", content: [t("note text")] }),
    );
    validate(b);
  });

  it("sorts and de-duplicates nested marks, code wins, sup excludes sub", () => {
    const b = blocks("<p><i><b>x</b></i><b><code>y</code></b><sup><sub>z</sub></sup></p>");
    expect(b[0]).toEqual(
      p(
        { type: "text", text: "x", marks: [{ type: "bold" }, { type: "italic" }] },
        t("y", "code"),
        t("z", "subscript"),
      ),
    );
    validate(b);
  });

  it("maps blockquotes, bullet and ordered lists with start, and nested lists", () => {
    const b = blocks(
      "<blockquote><p>q</p></blockquote><ul><li>a<ul><li>a1</li></ul></li><li><p>b</p></li></ul><ol start='4'><li>x</li></ol><ol start='1'><li>y</li></ol>",
    );
    expect(b.map((n) => n.type)).toEqual([
      "blockquote",
      "bulletList",
      "orderedList",
      "orderedList",
    ]);
    const ul = b[1] as { content: { content: DocNode[] }[] };
    expect(ul.content[0]!.content.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    expect((b[2] as { attrs: unknown }).attrs).toEqual({ start: 4 });
    expect("attrs" in b[3]!).toBe(false);
    validate(b);
  });

  it("keeps stray content inside a list as an item and drops empty lists", () => {
    const b = blocks("<ul>stray<li>a</li></ul><ul></ul><blockquote></blockquote>");
    expect(b.map((n) => n.type)).toEqual(["bulletList", "blockquote"]);
    expect((b[0] as { content: unknown[] }).content).toHaveLength(2);
    validate(b);
  });

  it("maps pre>code with language and keeps whitespace", () => {
    const b = blocks(
      '<pre><code class="language-ts">let  a = 1;\n  b();\n</code></pre><pre>plain\n<b>x</b><br>y</pre><pre></pre>',
    );
    expect(b[0]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "let  a = 1;\n  b();" }],
    });
    expect(b[1]).toEqual({ type: "codeBlock", content: [{ type: "text", text: "plain\nx\ny" }] });
    expect(b[2]).toEqual({ type: "codeBlock" });
    validate(b);
  });

  it("splits at <br> with an info warning", () => {
    const r = htmlToBlocks("<p>a<br>b<br><br>c</p>");
    expect(r.blocks).toEqual([p(t("a")), p(t("b")), p(t("c"))]);
    expect(r.warnings).toMatchObject([{ code: "line-break", severity: "info" }]);
  });

  it("maps tables with a header row and ragged rows", () => {
    const r = htmlToBlocks(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><b>2</b></td></tr><tr><td>3</td></tr></tbody></table>",
    );
    const table = r.blocks[0] as { type: string; content: { content: { type: string }[] }[] };
    expect(table.type).toBe("table");
    expect(table.content).toHaveLength(3);
    expect(table.content[0]!.content.map((c) => c.type)).toEqual(["tableHeader", "tableHeader"]);
    expect(table.content[2]!.content).toHaveLength(2);
    expect(r.warnings.map((w) => w.code)).toEqual(["table-merged"]);
    validate(r.blocks);
  });

  it("treats a first row of th cells as the header, and warns on colspan/rowspan and complex cells", () => {
    const r = htmlToBlocks(
      "<table><caption>Cap</caption><tr><th>a</th><th>b</th></tr><tr><td colspan=2>x</td></tr><tr><td><ul><li>l</li></ul><img src='assets/a.png' alt='alt'></td><td rowspan=2>z</td></tr></table>",
    );
    expect(r.blocks.map((b) => b.type)).toEqual(["paragraph", "table"]);
    expect([...new Set(r.warnings.map((w) => w.code))].sort()).toEqual([
      "table-complex",
      "table-merged",
    ]);
    expect(text(r.blocks[1])).toContain("tableHeader");
    expect(text(r.blocks[1])).toContain("alt");
    validate(r.blocks);
  });

  it("drops tables with no cells", () => {
    expect(blocks("<table></table><table><tr></tr></table>")).toEqual([]);
  });
});

describe("links and images", () => {
  it("keeps http, https and mailto links and refuses the rest", () => {
    const r = htmlToBlocks(
      '<p><a href="https://a.test/x">ok</a> <a href="mailto:a@b.test">m</a> <a href="javascript:alert(1)">bad</a> <a href=" ftp://x">ftp</a> <a href="#top">anchor</a> <a name="n">name</a></p>',
    );
    const out = text(r.blocks);
    expect(out).toContain('"href":"https://a.test/x"');
    expect(out).toContain('"href":"mailto:a@b.test"');
    expect(out).not.toContain("javascript");
    expect(out).toContain("bad");
    expect(r.warnings.filter((w) => w.code === "unsafe-link")).toHaveLength(2);
    validate(r.blocks);
  });

  it("registers local images, keeps alt and title, and never imports remote or data: images", () => {
    const r = importHtml(
      '<p>x <img src="pics/My%20Pic.png" alt="A pic" title="Cap"> y</p><img src="https://e.test/a.png" alt="remote"><img src="data:image/png;base64,AAAA" alt="inline"><img src="a.txt"><img alt="none">',
    );
    expect(r.assets.map((a) => a.sourcePath)).toEqual(["pics/My Pic.png"]);
    const body = r.chapters[0]!.doc.content;
    expect(body.find((n) => n.type === "image")).toEqual({
      type: "image",
      attrs: { src: "assets/My_Pic.png", alt: "A pic", title: "Cap" },
    });
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["remote-image", "unsupported-image"]),
    );
    expect(text(body)).toContain("[Image: remote]");
    expect(text(body)).not.toContain("base64");
    expectValid(r);
  });
});

describe("whitespace and entities", () => {
  it("collapses whitespace outside pre, trims paragraph edges and decodes entities", () => {
    const b = blocks(
      "<p>\n   a \t b   <b> c </b>  &amp; &lt;d&gt; &copy; &#65;&nbsp;e  </p>\n\n   <p>   </p><div>  \n </div>",
    );
    expect(b).toEqual([p(t("a b "), t("c ", "bold"), t("& <d> © A e"))]);
  });

  it("wraps top-level inline text in paragraphs and separates divs", () => {
    expect(blocks("hello <b>there</b><div>one<div>two</div>three</div>")).toEqual([
      p(t("hello "), t("there", "bold")),
      p(t("one")),
      p(t("two")),
      p(t("three")),
    ]);
  });
});

describe("unknown and dropped elements", () => {
  it("keeps the text of unknown elements with one aggregated warning", () => {
    const r = htmlToBlocks("<p><mark>a</mark> <mark>b</mark> <blink>c</blink></p>");
    expect(r.blocks).toEqual([p(t("a b c"))]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({
      code: "unsupported-element",
      count: 3,
      examples: ["<mark>", "<blink>"],
    });
  });

  it("drops script, style, iframe, object, svg, noscript, template and comments with their content", () => {
    const html =
      "<p>keep</p><script>SECRET_JS()</script><style>.SECRET_CSS{}</style><iframe src='x'>SECRET_IFRAME</iframe><object>SECRET_OBJ</object><svg><text>SECRET_SVG</text></svg><noscript>SECRET_NS</noscript><template><p>SECRET_TPL</p></template><!-- SECRET_COMMENT --><p onclick='SECRET_ATTR()'>after</p>";
    const r = htmlToBlocks(html);
    expect(text(r.blocks)).not.toContain("SECRET");
    expect(r.blocks).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });
});

describe("htmlToInline", () => {
  it("returns inline nodes for a snippet", () => {
    expect(htmlToInline("<b>a</b> and <i>b</i>")).toEqual([
      t("a", "bold"),
      t(" and "),
      t("b", "italic"),
    ]);
    expect(htmlToInline("<p>x</p><p>y</p><img src='a.png'>")).toEqual([t("x y")]);
    expect(htmlToInline("")).toEqual([]);
  });
});

describe("looksLikeHtml", () => {
  it("is true for recognised elements", () => {
    for (const s of [
      "<p>hi</p>",
      "<b>x</b>",
      "a <i>b</i>",
      "<br>",
      "<hr/>",
      '<a href="x">y</a>',
      "<h2>t</h2>",
      "<img src='a.png'>",
      "<table><tr><td>x</td></tr></table>",
      "<DIV>x</DIV>",
    ]) {
      expect(looksLikeHtml(s), s).toBe(true);
    }
  });
  it("is false for plain text that merely contains angle brackets", () => {
    for (const s of [
      "a < b",
      "<3",
      "x<y>z",
      "1 < 2 > 0",
      "a <-> b",
      "<>",
      "</>",
      "<script>x</script>",
      "<custom-el>x</custom-el>",
      "",
      "if (a<b && c>d) {}",
      "<!-- c -->",
      "plain",
    ]) {
      expect(looksLikeHtml(s), s).toBe(false);
    }
  });
});

describe("importHtml", () => {
  it("splits chapters on h1 and uses the title for content before the first heading", () => {
    const r = importHtml(
      "<html><head><title>My Book</title></head><body><p>pre</p><h1>One</h1><p>a</p><h1>Two</h1><p>b</p></body></html>",
    );
    expect(r.chapters.map((c) => c.title)).toEqual(["My Book", "One", "Two"]);
    expect(r.warnings.map((w) => w.code)).toEqual(["untitled-content"]);
    expectValid(r);
  });

  it("falls back to the title, then the first heading, then the option for a single chapter", () => {
    expect(importHtml("<title>T</title><p>x</p>").chapters[0]!.title).toBe("T");
    expect(importHtml("<h2>First</h2><p>x</p>").chapters[0]!.title).toBe("First");
    expect(importHtml("<p>x</p>", { untitledTitle: "Nameless" }).chapters[0]!.title).toBe(
      "Nameless",
    );
    expect(importHtml("<p>x</p>").warnings.map((w) => w.code)).toEqual(["no-headings"]);
  });

  it("respects splitHeadingLevel and reports empty input", () => {
    expect(
      importHtml("<h2>A</h2><p>x</p><h2>B</h2>", { splitHeadingLevel: 2 }).chapters.map(
        (c) => c.title,
      ),
    ).toEqual(["A", "B"]);
    const r = importHtml(
      "<html><head><title>x</title><script>1</script></head><body></body></html>",
    );
    expect(r.chapters).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(["empty-input"]);
  });

  it("ignores script and style text and a leading BOM", () => {
    const r = importHtml(
      "﻿<!doctype html><title>t</title><style>h1{}</style><h1>A</h1><script>alert('SECRET')</script><p>x</p>",
    );
    expect(text(r)).not.toContain("SECRET");
    expect(r.chapters).toHaveLength(1);
  });
});

describe("hostile input", () => {
  it("refuses input over maxInputChars", () => {
    expect(() => htmlToBlocks("<p>x</p>", { maxInputChars: 3 })).toThrowError(
      expect.objectContaining({ code: "input-too-large" }),
    );
    expect(() => importHtml("<p>x</p>", { maxInputChars: 3 })).toThrow(ImportError);
  });

  it("refuses 100,000 nested elements instead of overflowing the stack", () => {
    for (const tag of ["div", "span", "blockquote", "ul", "b"]) {
      const html = `<${tag}>`.repeat(100_000) + "x";
      expect(() => htmlToBlocks(html), tag).toThrowError(
        expect.objectContaining({ code: "too-deeply-nested" }),
      );
      expect(() => importHtml(html), tag).toThrow(ImportError);
    }
    expect(() => looksLikeHtml("<div>".repeat(100_000))).not.toThrow();
  });

  it("stays fast on other pathological nesting", () => {
    for (const tag of [
      "table",
      "a",
      "font",
      "form",
      "select",
      "template",
      "svg",
      "tr",
      "td",
      "li",
      "p",
      "pre",
      "h1",
      "section",
      "dl",
      "i",
      "code",
    ]) {
      const html = `<${tag}>`.repeat(50_000) + "x";
      const t0 = Date.now();
      try {
        htmlToBlocks(html);
        importHtml(html);
      } catch (e) {
        expect(e, tag).toBeInstanceOf(ImportError);
      }
      expect(Date.now() - t0, tag).toBeLessThan(2000);
    }
  }, 60_000);

  it("flattens nesting deeper than maxNestingDepth with a warning", () => {
    const html = "<blockquote>".repeat(50) + "deep" + "</blockquote>".repeat(50);
    const r = htmlToBlocks(html, { maxNestingDepth: 5 });
    expect(r.warnings.map((w) => w.code)).toEqual(["nesting-too-deep"]);
    expect(text(r.blocks)).toContain("deep");
    validate(r.blocks);
  });

  it("handles a large document of unclosed tags", () => {
    const r = htmlToBlocks("<p>row <b>x</p>".repeat(20_000));
    expect(r.blocks.length).toBeGreaterThan(1000);
    validate(r.blocks.slice(0, 50));
  });

  it("keeps script payloads out of malformed markup", () => {
    const r = htmlToBlocks(
      '<p>a</p><scr<script>ipt>SECRET</script>x<img src=x onerror=SECRET2()><a href="JaVaScRiPt:SECRET3">l</a>',
    );
    expect(text(r.blocks)).not.toMatch(/SECRET2|SECRET3|onerror/);
    validate(r.blocks);
  });
});

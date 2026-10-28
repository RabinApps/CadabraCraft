import { describe, expect, it } from "vitest";
import { chapterDocProblem } from "@cadabracraft/editor-schema";
import { Node } from "@tiptap/pm/model";
import type { DocNode } from "@cadabracraft/shared";
import {
  ImportError,
  htmlToBlocks,
  htmlToInline,
  importHtml,
  importMarkdown,
  looksLikeHtml,
  type ImportResult,
} from "..";
import { schema } from "./helpers";

/** Every doc must pass both the app's validator and a strict ProseMirror check. */
function assertValidDoc(doc: unknown, label: string): void {
  expect(chapterDocProblem(doc), label).toBeNull();
  expect(() => Node.fromJSON(schema, doc as never).check(), label).not.toThrow();
}
function assertValid(r: ImportResult, label = ""): void {
  for (const c of r.chapters) assertValidDoc(c.doc, label);
}
const blocksDoc = (b: DocNode[]) => ({
  type: "doc",
  content: b.length ? b : [{ type: "paragraph" }],
});
const json = (x: unknown) => JSON.stringify(x);
const texts = (x: unknown): string[] =>
  [...json(x).matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);

/** Runs `fn`, requiring that the only error that may escape is an `ImportError`. */
function importErrorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e, String(e)).toBeInstanceOf(ImportError);
    return (e as ImportError).code;
  }
  return undefined;
}

describe("HTML input robustness", () => {
  it("handles empty, whitespace-only, BOM-only and comment-only input in every entry point", () => {
    for (const s of [
      "",
      " \n\t ",
      "﻿",
      "<!-- only a comment -->",
      "<!DOCTYPE html>",
      "<html><head><title>T</title></head><body></body></html>",
    ]) {
      const r = importHtml(s);
      expect(r.chapters, JSON.stringify(s)).toEqual([]);
      expect(htmlToBlocks(s).blocks).toEqual([]);
      expect(htmlToInline(s)).toEqual([]);
      expect(looksLikeHtml(s)).toBe(false);
    }
  });

  it("keeps NUL and other XML-illegal control characters out of the output (they would make the EPUB's XHTML invalid)", () => {
    const r = importHtml(
      "<p>a\u0000b\u0001c\u000Bd\u001Fe￾f￿g</p><pre>x\u0000y\u0002z</pre><p><span class='footnote'>n\u0003ote</span></p>",
    );
    const all = json(r.chapters);
    expect(all).not.toMatch(/\\u00(0[0-8bBcC]|1[0-9a-fA-F])|\\ufff[ef]/i);
    expect(texts(r.chapters).join("")).toContain("abcdefg");
    expect(all).toContain("xyz");
    expect(all).toContain("note");
    assertValid(r);
  });

  it("replaces lone surrogates with U+FFFD and keeps pairs", () => {
    const r = importHtml("<p>a\ud800b\udc00c\u{1F600}d</p>");
    const t = texts(r.chapters).join("");
    expect(t).toBe("a�b�c\u{1F600}d".replace(/\\/g, "\\\\"));
    for (const s of ["\ud800", "x\udfff"]) {
      const md = importMarkdown(`# T\n\n${s} y\n\n\`\`\`\n${s}\n\`\`\`\n`);
      expect(json(md.chapters)).not.toMatch(/\\ud[89a-f]/i);
    }
  });

  it("keeps zero-width, bidi, RTL and emoji ZWJ sequences exactly", () => {
    const s = "a​b‮c⁧d‍‎‏ e שלום مرحبا \u{1F468}‍\u{1F469}‍\u{1F467} \u{1F3F3}️‍\u{1F308}";
    const r = htmlToBlocks(`<p>${s}</p>`);
    expect((r.blocks[0] as { content: { text: string }[] }).content[0]!.text).toBe(s);
  });

  it("decodes entities, and leaves invalid or unterminated ones alone", () => {
    const text = (h: string) =>
      (htmlToBlocks(h).blocks[0] as { content: { text: string }[] }).content[0]!.text;
    expect(text("<p>a&nbsp;b&amp;c&lt;d&#65;&#x42;&#128512;</p>")).toBe("a b&c<dAB\u{1F600}");
    expect(text("<p>&bogus; &amp &notanentity; &#xZZ; &#99999999999;</p>")).toContain("&bogus;");
    expect(text("<p>&#0;&#x110000;&#xD800;x</p>")).toBe("���x");
    expect(text("<p>AT&T &copy 2024</p>")).toContain("AT&T");
  });

  it("ignores CDATA, comments, processing instructions, doctype quirks, base and meta refresh", () => {
    const r = importHtml(
      "<?xml version='1.0'?><!DOCTYPE foo SYSTEM 'x'><!-- c --><![CDATA[cd]]><base href='http://evil/'><meta http-equiv='refresh' content='0;url=http://evil/'><link rel=stylesheet href=x.css><p>kept</p><!-->",
    );
    expect(texts(r.chapters).join(" ")).toBe("kept");
    assertValid(r);
  });

  it("drops svg/math script, template, noscript, iframe, object, embed content and keeps custom-element, math and form text sensibly", () => {
    const r = importHtml(
      "<svg><title>svgt</title><text>svgtext</text><script>SECRET</script></svg><template><p>tpl</p></template><noscript>ns</noscript><iframe>if</iframe><object>obj<param name=x></object><embed src=x>" +
        "<my-element>custom</my-element><math><mi>m</mi><script>SECRET</script></math><form><input value='v' type='text'><textarea>ta</textarea><button>btn</button><select><option>o1</option><option>o2</option></select></form>",
    );
    const t = texts(r.chapters).join(" ");
    for (const gone of ["svgt", "svgtext", "SECRET", "tpl", "ns", "if", "obj", "o1", "o2"])
      expect(t, gone).not.toContain(gone);
    for (const kept of ["custom", "ta", "btn"]) expect(t, kept).toContain(kept);
    assertValid(r);
  });

  it("never glues options of a select into one word", () => {
    expect(
      texts(
        htmlToBlocks("<p>Pick <select><option>one</option><option>two</option></select> now</p>")
          .blocks,
      ).join(""),
    ).not.toMatch(/onetwo/);
  });

  it("collapses runs of <br> without empty paragraphs and mixes inline and block text", () => {
    expect(htmlToBlocks("a<br><br><br>b").blocks.map((b) => texts(b).join(""))).toEqual(["a", "b"]);
    expect(htmlToBlocks("<br><br>").blocks).toEqual([]);
    const b = htmlToBlocks(
      "top<ul><li>li text<p>para</p>tail</li></ul>mid<blockquote>bq<h2>h</h2>bq2</blockquote><table><tr><td>cell<div>block</div>after</td></tr></table>end",
    ).blocks;
    expect(b.map((n) => n.type)).toEqual([
      "paragraph",
      "bulletList",
      "paragraph",
      "blockquote",
      "table",
      "paragraph",
    ]);
    validateBlocks(b);
  });

  it("drops paragraphs that hold only spaces or no-break spaces", () => {
    expect(htmlToBlocks("<p></p><p> </p><p>&nbsp;</p><p>  </p>&nbsp;<p>x</p>").blocks).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "x" }] },
    ]);
  });

  it("handles nested tables, tables in lists, empty and ragged tables and cells with block children", () => {
    const html =
      "<table><tr><td><table><tr><td>in</td><td>in2</td></tr></table></td><td>x</td></tr></table>" +
      "<ul><li><table><tr><th>h</th></tr><tr><td>c</td></tr></table></li></ul>" +
      "<table></table><table><tr></tr></table><table><tbody></tbody></table><table><tr><td></td></tr></table>" +
      "<table><tr><td>a<td>b<td>c<tr><td>d<tr><td>e<td>f</table>" +
      "<table><caption>Cap</caption><tr><td><h1>H</h1><ul><li>l1<li>l2</ul><blockquote>q</blockquote><pre>code</pre><img src='a.png'><hr></td></tr></table>";
    const r = htmlToBlocks(html);
    validateBlocks(r.blocks);
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["table-complex", "table-merged"]),
    );
    const t = texts(r.blocks).join(" ");
    for (const w of ["in2", "Cap", "H", "l1", "l2", "q", "code"]) expect(t).toContain(w);
  });

  it("flattens lists inside paragraphs, orphan <li>, definition lists and headings in lists and quotes", () => {
    const html =
      "<p>a<ul><li>b</li></ul>c</p><li>orphan</li><dl><dt>term</dt><dd>def</dd></dl><ul><li><h2>H</h2></li></ul><blockquote><h1>Q</h1></blockquote><h1> </h1><h2><img src='a.png'></h2>";
    const b = htmlToBlocks(html).blocks;
    validateBlocks(b);
    const t = texts(b).join(" ");
    for (const w of ["a", "b", "c", "orphan", "term", "def", "H", "Q"]) expect(t).toContain(w);
  });

  it("keeps pre whitespace, drops only the first newline and handles code with nested marks", () => {
    const b = htmlToBlocks(
      "<pre>\n\n\tx\n\ty\n\n</pre><pre><code class='language-js'>a<b>b</b><i>c</i>\u0000</code></pre><p><code><b>x</b><i>y</i></code> <code>z<sup>2</sup></code></p>",
    ).blocks;
    expect(b[0]).toEqual({ type: "codeBlock", content: [{ type: "text", text: "\n\tx\n\ty\n" }] });
    expect(b[1]).toEqual({
      type: "codeBlock",
      attrs: { language: "js" },
      content: [{ type: "text", text: "abc" }],
    });
    validateBlocks(b);
    for (const n of (b[2] as { content: { marks?: { type: string }[] }[] }).content)
      if (n.marks?.some((m) => m.type === "code")) expect(n.marks).toEqual([{ type: "code" }]);
  });

  it("keeps duplicate and crossed marks valid and in schema order", () => {
    const b = htmlToBlocks(
      "<p><b><b>a</b></b><i>b<i>c</i></i><u><s><em><strong><sup>d</sup></strong></em></s></u><a href='http://x.com'><u><b>e</b></u></a><b>f<i>g</b>h</i></p>",
    ).blocks;
    validateBlocks(b);
  });

  it("small-caps in every spelling, case and spacing; other classes and styles do not trigger it", () => {
    const yes = [
      '<span style="font-variant:small-caps">',
      '<span style="FONT-VARIANT : SMALL-CAPS">',
      '<span style="color:red;font-variant-caps: all-small-caps !important">',
      '<span class="x small-caps y">',
      '<span style="font-variant: small-caps;">',
    ];
    const no = [
      '<span style="font-variant:normal">',
      '<span class="small-caps-not">',
      '<span class="smallcaps">',
      '<span style="font-variant:titling-caps">',
      "<span>",
    ];
    for (const o of yes)
      expect(json(htmlToBlocks(`<p>${o}a</span></p>`).blocks), o).toContain("smallCaps");
    for (const o of no)
      expect(json(htmlToBlocks(`<p>${o}a</span></p>`).blocks), o).not.toContain("smallCaps");
  });
});

describe("HTML links and images", () => {
  const linkOf = (href: string) => {
    const r = htmlToBlocks(`<p><a href="${href}">x</a></p>`);
    return {
      href: /"href":"([^"]*)"/.exec(json(r.blocks))?.[1],
      codes: r.warnings.map((w) => w.code),
    };
  };

  it("keeps only http, https and mailto, however the scheme is disguised", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "java&#9;script:alert(1)",
      "&#106;avascript:alert(1)",
      "jav&#x61;script:alert(1)",
      "\u0001javascript:alert(1)",
      "vbscript:x",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "//evil.example/x",
      "/relative/path",
      "relative.html",
      "ftp://x/y",
      "http://exa mple.com",
      "http://",
      "",
      "   ",
      "mailto:",
    ]) {
      const { href } = linkOf(bad);
      // "mailto:" alone has no address but is harmless; everything else must be dropped.
      if (bad === "mailto:") continue;
      expect(href, JSON.stringify(bad)).toBeUndefined();
    }
    expect(linkOf("HTTPS://Example.com/a b".replace(" ", "%20")).href).toBe(
      "https://example.com/a%20b",
    );
    expect(linkOf(" http://x.com ").href).toBe("http://x.com/");
    expect(linkOf("mailto:a@b.co").href).toBe("mailto:a@b.co");
  });

  it("treats a link without href and an in-page anchor as plain text, with no warning", () => {
    for (const h of [
      "<a>x</a>",
      "<a name='n'>x</a>",
      "<a href='#top'>x</a>",
      "<a href='  #top'>x</a>",
    ]) {
      const r = htmlToBlocks(`<p>${h}</p>`);
      expect(json(r.blocks), h).not.toContain("link");
      expect(r.warnings, h).toEqual([]);
    }
  });

  it("handles images: missing, empty, data:, srcset-only, protocol-relative, alt-only, huge alt and duplicate names", () => {
    const huge = "z".repeat(2_000_000);
    const r = importHtml(
      `<img><img src=''><img src='  '><img alt='only alt'><img src='data:image/png;base64,AAAA' alt='d'><img srcset='a.png 1x, b.png 2x' alt='s'><img src='//h.example/x.png' alt='pr'>` +
        `<img src='a/x.png'><img src='b/x.png'><img src='C/X.PNG'><img src='deep/../../etc/passwd.png'><img src='file:///etc/x.png'><img src='x.exe'><img src='p.png?v=1#f' alt='q' title='t'><img alt='${huge}' src='huge.png'>`,
    );
    assertValid(r);
    const targets = r.assets.map((a) => a.targetPath);
    expect(new Set(targets.map((t) => t.toLowerCase())).size).toBe(targets.length);
    expect(targets).toEqual(
      expect.arrayContaining([
        "assets/x.png",
        "assets/x-2.png",
        "assets/X.PNG".replace("X.PNG", "X-3.PNG"),
      ]),
    );
    for (const t of targets) expect(t).toMatch(/^assets\/[A-Za-z0-9._-]+$/);
    expect(r.assets.map((a) => a.sourcePath)).toContain("p.png");
    const codes = new Set(r.warnings.map((w) => w.code));
    expect(codes.has("remote-image")).toBe(true);
    expect(codes.has("unsupported-image")).toBe(true);
    expect(texts(r.chapters).join(" ")).toContain("[Image: only alt]");
  });
});

describe("Result invariants and error handling", () => {
  it("every failure is an ImportError with a stable code", () => {
    expect(importErrorCode(() => importHtml("x".repeat(101), { maxInputChars: 100 }))).toBe(
      "input-too-large",
    );
    expect(importErrorCode(() => htmlToBlocks("x".repeat(101), { maxInputChars: 100 }))).toBe(
      "input-too-large",
    );
    expect(importErrorCode(() => htmlToInline("x".repeat(101), { maxInputChars: 100 }))).toBe(
      "input-too-large",
    );
    expect(importErrorCode(() => importMarkdown("x".repeat(101), { maxInputChars: 100 }))).toBe(
      "input-too-large",
    );
    expect(importErrorCode(() => importHtml("<div>".repeat(5000)))).toBe("too-deeply-nested");
    expect(importErrorCode(() => htmlToBlocks("<div>".repeat(5000)))).toBe("too-deeply-nested");
    expect(importErrorCode(() => htmlToInline("<span>".repeat(5000) + "x"))).toBe(
      "too-deeply-nested",
    );
    expect(importErrorCode(() => importMarkdown("<div>".repeat(5000)))).toBe("too-deeply-nested");
    expect(importErrorCode(() => importHtml("<template>".repeat(100_000)))).toBe(
      "too-deeply-nested",
    );
    expect(importErrorCode(() => importHtml("<b>".repeat(100_000)))).toBe("too-deeply-nested");
  });

  it("refuses a tag with an absurd number of attributes (parse5 is quadratic on them) with code input-too-large, even with quoted > tricks", () => {
    const attrs = (n: number) => Array.from({ length: n }, (_, i) => `a${i}="1>"`).join(" ");
    const start = performance.now();
    expect(importErrorCode(() => importHtml(`<p ${attrs(200_000)}>x</p>`))).toBe("input-too-large");
    expect(importErrorCode(() => htmlToBlocks(`<p ${attrs(200_000)}>x</p>`))).toBe(
      "input-too-large",
    );
    expect(importErrorCode(() => importMarkdown(`<div ${attrs(200_000)}>x</div>`))).toBe(
      "input-too-large",
    );
    expect(looksLikeHtml(`<p ${attrs(200_000)}>x</p>`)).toBe(true);
    expect(importErrorCode(() => importHtml(`<p ${attrs(4_000)}>x</p>`))).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it("looksLikeHtml never throws, even on 300,000 sibling elements or hostile nesting", () => {
    expect(looksLikeHtml("<foo>x</foo>".repeat(300_000))).toBe(false);
    expect(looksLikeHtml("<foo>x</foo>".repeat(300_000) + "<b>x</b>")).toBe(true);
    for (const s of [
      "<".repeat(100_000),
      "<div>".repeat(100_000),
      "<b>".repeat(100_000),
      "<template>".repeat(100_000),
      "<a ".repeat(50_000),
      "\u0000<p>\ud800",
      "<p " + "a=1 ".repeat(100_000) + ">",
    ]) {
      expect(() => looksLikeHtml(s)).not.toThrow();
    }
    expect(looksLikeHtml(undefined as unknown as string)).toBe(false);
  });

  it("caps warnings and truncates examples however much hostile content there is", () => {
    const many = [
      "<a href='javascript:x'>l</a>".repeat(20_000),
      "<foo>x</foo><bar>y</bar>".repeat(10_000),
      Array.from(
        { length: 5000 },
        (_, i) =>
          `<unknown-tag-${i}>t</unknown-tag-${i}><img src='http://h/${"p".repeat(500)}${i}.png'>`,
      ).join(""),
      "<h5>x</h5>".repeat(20_000),
      "<p>a<br>b</p>".repeat(20_000),
    ].join("");
    const r = importHtml(many);
    expect(r.warnings.length).toBeLessThan(120);
    for (const w of r.warnings) {
      expect(w.message.length).toBeLessThan(400);
      expect(w.examples?.length ?? 0).toBeLessThanOrEqual(5);
      for (const e of w.examples ?? []) expect(e.length).toBeLessThanOrEqual(80);
    }
    expect(json(r.warnings).length).toBeLessThan(30_000);
    assertValid(r);
  });

  it("never emits script or style text for any placement of the elements", () => {
    const places = [
      "<p>A</p>",
      "<ul><li>",
      "<table><tr><td>",
      "<blockquote>",
      "<h1>",
      "<svg>",
      "<math>",
      "<select>",
      "<pre>",
      "<a href='http://x.com'>",
      "<span class=footnote>",
      "<template>",
      "<form>",
      "<table>",
      "<b>",
      "<noscript>",
    ];
    for (const p of places) {
      const r = importHtml(`${p}<script>SECRET1</script><style>SECRET2</style>visible`);
      assertValid(r, p);
      expect(json(r), p).not.toMatch(/SECRET/);
    }
  });
});

describe("Performance bounds", () => {
  const within = (ms: number, fn: () => void) => {
    const t0 = performance.now();
    fn();
    expect(performance.now() - t0).toBeLessThan(ms);
  };

  it("imports a million tiny inline elements in a few seconds", () => {
    within(8000, () => {
      const r = importHtml("<b>x</b>".repeat(1_000_000));
      expect(r.chapters).toHaveLength(1);
    });
  }, 30_000);

  it("snippets are not slower than documents: 400,000 flat elements through htmlToBlocks and looksLikeHtml", () => {
    const html = "a <i>b</i> ".repeat(400_000);
    within(6000, () => {
      expect(htmlToBlocks(html).blocks).toHaveLength(1);
    });
    within(6000, () => expect(looksLikeHtml(html)).toBe(true));
  }, 30_000);

  it("one very long word, one very long line, a huge attribute and many attributes", () => {
    within(5000, () => {
      const word = "w".repeat(20_000_000);
      const r = importHtml(
        `<h1>T</h1><p>${word}</p><a href="http://x.com/${"q".repeat(5_000_000)}">l</a><a href="${"j".repeat(5_000_000)}">m</a><p ${Array.from({ length: 4_000 }, (_, i) => `a${i}=1`).join(" ")}>z</p>`,
      );
      assertValid(r);
      expect(json(r).length).toBeGreaterThan(20_000_000);
    });
  }, 30_000);

  it("a million <br>, comments, entities and unclosed paragraphs stay linear", () => {
    within(10_000, () => {
      importHtml("a<br>".repeat(1_000_000));
      importHtml("<!--x-->".repeat(1_000_000) + "<p>y</p>");
      importHtml("&amp;&nbsp;&#x41;".repeat(1_000_000));
      importHtml("<p>x".repeat(500_000));
      importHtml("<ul>" + "<li>x".repeat(300_000));
    });
  }, 30_000);
});

function validateBlocks(b: DocNode[]): void {
  assertValidDoc(blocksDoc(b), json(b).slice(0, 120));
}

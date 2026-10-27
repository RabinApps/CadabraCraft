import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertChapterDoc } from "@cadabracraft/editor-schema";
import { importMarkdown } from "@cadabracraft/import-docx";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { MarkdownExportError, bookToMarkdown, chapterToMarkdown, chaptersToMarkdown } from "./index";

const sample = (): ChapterDoc => JSON.parse(readFileSync(new URL("../../../fixtures/manuscripts/sample-chapter.json", import.meta.url), "utf8"));
const fullBook = (): { chapters: { title: string; doc: ChapterDoc }[] } => JSON.parse(readFileSync(new URL("../../../fixtures/manuscripts/full-book.json", import.meta.url), "utf8"));

const t = (text: string, ...marks: Mark[]): DocNode => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const m = (type: Mark["type"], href?: string): Mark => (href ? { type, attrs: { href } } : { type });

/** doc -> markdown -> importer. Asserts the importer accepts the output and reports no warnings. */
function roundTrip(d: ChapterDoc): ChapterDoc {
  const md = chapterToMarkdown(d);
  const r = importMarkdown(md);
  expect(r.warnings.filter((w) => w.code !== "no-headings"), md).toEqual([]);
  const out = r.chapters.length === 1 ? r.chapters[0]!.doc : { type: "doc" as const, content: r.chapters.flatMap((c) => c.doc.content) };
  assertChapterDoc(out);
  return unlink(out) as ChapterDoc;
}

/** Marks that survive the Markdown round trip; the others have no syntax. */
const LOSSY = new Set(["underline", "smallCaps", "superscript", "subscript"]);
function stripLossy(n: DocNode): DocNode {
  if (n.type === "text") {
    const marks = (n.marks ?? []).filter((x) => !LOSSY.has(x.type));
    return marks.length ? { ...n, marks } : { type: "text", text: n.text };
  }
  return "content" in n && n.content ? { ...n, content: merge(n.content.map(stripLossy)) } : n;
}
function merge(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === "text" && prev?.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) out[out.length - 1] = { ...prev, text: prev.text + n.text };
    else out.push(n);
  }
  return out;
}
/** The importer's GFM autolink literals turn bare URLs and e-mail addresses into links; undo that so text can be compared. */
function unlink(n: DocNode): DocNode {
  if (n.type === "text") {
    const marks = (n.marks ?? []).filter((x) => !(x.type === "link" && /^(https?:\/\/|www\.|[^\s@]+@)/.test(n.text)));
    return marks.length ? { ...n, marks } : { type: "text", text: n.text };
  }
  return "content" in n && n.content ? { ...n, content: merge(n.content.map(unlink)) } : n;
}
const normalised = (d: ChapterDoc): ChapterDoc => stripLossy(d) as ChapterDoc;

describe("node mapping", () => {
  it("writes paragraphs, headings, quotes, scene breaks and code", () => {
    const md = chapterToMarkdown(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [t("Title")] },
        p(t("Hello world.")),
        { type: "heading", attrs: { level: 3 }, content: [t("Deep")] },
        { type: "blockquote", content: [p(t("Quoted")), p(t("Second"))] },
        { type: "sceneBreak" },
        { type: "codeBlock", attrs: { language: "ts" }, content: [t("let a = 1;")] },
      ),
    );
    expect(md).toBe("# Title\n\nHello world.\n\n### Deep\n\n> Quoted\n>\n> Second\n\n* * *\n\n```ts\nlet a = 1;\n```\n");
  });

  it("uses a fence longer than any backtick run in the code", () => {
    const md = chapterToMarkdown(doc({ type: "codeBlock", content: [t("a ```` b\n```\nc")] }));
    expect(md).toBe("`````\na ```` b\n```\nc\n`````\n");
    expect(roundTrip(doc({ type: "codeBlock", content: [t("a ```` b\n```\nc")] })).content[0]).toEqual({ type: "codeBlock", content: [t("a ```` b\n```\nc")] });
    expect(chapterToMarkdown(doc({ type: "codeBlock" }))).toBe("```\n```\n");
  });

  it("writes nested bullet and ordered lists, keeping the start number", () => {
    const li = (...c: DocNode[]): DocNode => ({ type: "listItem", content: c });
    const d = doc({
      type: "orderedList",
      attrs: { start: 3 },
      content: [li(p(t("Three")), { type: "bulletList", content: [li(p(t("a"))), li(p(t("b")), { type: "orderedList", content: [li(p(t("deep")))] })] }), li(p(t("Four")), { type: "codeBlock", content: [t("x\ny")] })],
    });
    const md = chapterToMarkdown(d);
    expect(md).toBe("3. Three\n   - a\n   - b\n     1. deep\n4. Four\n\n   ```\n   x\n   y\n   ```\n");
    expect(roundTrip(d)).toEqual(d);
  });

  it("keeps two lists of the same kind apart", () => {
    const li = (s: string): DocNode => ({ type: "listItem", content: [p(t(s))] });
    const d = doc({ type: "bulletList", content: [li("a")] }, { type: "bulletList", content: [li("b")] }, { type: "orderedList", content: [li("c")] }, { type: "orderedList", content: [li("d")] });
    expect(roundTrip(d)).toEqual(d);
  });

  it("writes images with the caption as title and a prefix on relative paths", () => {
    const img: DocNode = { type: "image", attrs: { src: "assets/gradient.png", alt: "A [grad]", title: 'The "caption"' } };
    expect(chapterToMarkdown(doc(img))).toBe('![A \\[grad\\]](assets/gradient.png "The \\"caption\\"")\n');
    expect(chapterToMarkdown(doc(img), { imageBase: "../" })).toContain("](../assets/gradient.png ");
    const back = importMarkdown(chapterToMarkdown(doc(img)));
    expect(back.chapters[0]!.doc.content[0]).toEqual({ type: "image", attrs: { src: "assets/gradient.png", alt: "A [grad]", title: 'The "caption"' } });
    expect(chapterToMarkdown(doc({ type: "image", attrs: { src: "assets/my pic (1).png", alt: null, title: null } }))).toBe("![](assets/my%20pic%20%281%29.png)\n");
    expect(importMarkdown("![](assets/my%20pic%20%281%29.png)").chapters[0]!.doc.content[0]).toMatchObject({ attrs: { src: "assets/my_pic__1_.png" } });  });

  it("writes footnotes as [^n] with definitions at the end, numbered across chapters", () => {
    const d = doc(p(t("One"), { type: "footnote", content: [t("Note "), t("A", m("bold"))] }, t(" two"), { type: "footnote", content: [t("Note B")] }));
    expect(chapterToMarkdown(d)).toBe("One[^1] two[^2]\n\n[^1]: Note **A**\n\n[^2]: Note B\n");
    expect(roundTrip(d)).toEqual(d);
    const parts = chaptersToMarkdown({ title: "B" }, [{ title: "A", doc: d }, { title: "B", doc: d }]);
    expect(parts[1]).toContain("[^3]: Note **A**");
    expect(importMarkdown(parts.join("\n"), { splitHeadingLevel: 1 }).warnings).toEqual([]);
  });

  it("writes an empty footnote", () => {
    const d = doc(p(t("a"), { type: "footnote" }, t("b")));
    expect(chapterToMarkdown(d)).toBe("a[^1]b\n\n[^1]:\n");
    expect(roundTrip(d)).toEqual(d);
  });

  it("writes GFM tables with a header row, escaping pipes", () => {
    const cell = (type: "tableCell" | "tableHeader", ...c: DocNode[]): DocNode => ({ type, content: [p(...c)] });
    const d = doc({
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", t("Item")), cell("tableHeader", t("a|b"))] },
        { type: "tableRow", content: [cell("tableCell", t("x", m("bold"))), cell("tableCell", t("c|d", m("code")))] },
      ],
    });
    expect(chapterToMarkdown(d)).toBe("| Item | a\\|b |\n| --- | --- |\n| **x** | `c\\|d` |\n");
    expect(roundTrip(d)).toEqual(d);
  });

  it("gives a table without header cells an empty header row, and joins multi-paragraph cells", () => {
    const d = doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("a")), p(t("b"))] }, { type: "tableCell", content: [p()] }] }] });
    expect(chapterToMarkdown(d)).toBe("|  |  |\n| --- | --- |\n| a b |  |\n");
  });

  it("writes hard breaks as backslash line breaks", () => {
    expect(chapterToMarkdown(doc(p(t("a"), { type: "hardBreak" } as unknown as DocNode, t("b"))))).toBe("a\\\nb\n");
    const back = importMarkdown("a\\\nb");
    expect(back.chapters[0]!.doc.content).toEqual([p(t("a")), p(t("b"))]); // the importer splits paragraphs
  });

  it("skips empty paragraphs and writes an empty document as an empty string", () => {
    expect(chapterToMarkdown(doc({ type: "paragraph" }, p(t("x")), { type: "paragraph" }))).toBe("x\n");
    expect(chapterToMarkdown(doc())).toBe("");
  });
});

describe("marks", () => {
  it("writes bold, italic, strike, inline code and links", () => {
    const d = doc(p(t("a "), t("b", m("bold")), t(" "), t("c", m("italic")), t(" "), t("d", m("strike")), t(" "), t("e`f", m("code")), t(" "), t("g", m("link", "https://example.com/x?a=1&b=2")), t(" "), t("h", m("bold"), m("italic"))));
    expect(chapterToMarkdown(d)).toBe("a **b** *c* ~~d~~ ``e`f`` [g](https://example.com/x?a=1&b=2) ***h***\n");
    expect(roundTrip(d)).toEqual(d);
  });

  it("groups adjacent runs and keeps delimiters off whitespace", () => {
    expect(chapterToMarkdown(doc(p(t("x"), t(" bold ", m("bold")), t("y"))))).toBe("x **bold** y\n");
    expect(chapterToMarkdown(doc(p(t("a", m("bold")), t("b", m("bold"), m("italic")), t("c", m("bold")))))).toBe("**a*b*c**\n");
  });

  it("keeps bold directly followed by italic apart", () => {
    const d = doc(p(t("a", m("bold")), t("b", m("italic")), t("c", m("bold")), t("d", m("italic"))));
    expect(roundTrip(d)).toEqual(d);
  });

  it("pads code spans that start or end with a backtick or a space", () => {
    for (const code of ["`x", "x`", " x ", "a  b"]) {
      expect(roundTrip(doc(p(t(code, m("code")))))).toEqual(doc(p(t(code, m("code")))));
    }
  });

  it("links: parentheses, spaces and a link around other marks", () => {
    for (const href of ["https://example.com/a_(b)", "https://example.com/a)b", "https://example.com/?q=%20&x=1"]) {
      const d = doc(p(t("see "), t("here", m("link", href), m("bold")), t(".")));
      expect(roundTrip(d)).toEqual(d);
    }
  });

  it("throws for marks without Markdown syntax unless htmlMarks is set", () => {
    for (const type of ["underline", "smallCaps", "superscript", "subscript"] as const) {
      expect(() => chapterToMarkdown(doc(p(t("x", m(type)))))).toThrow(MarkdownExportError);
      expect(() => chapterToMarkdown(doc(p(t("x", m(type)))))).toThrow(/htmlMarks/);
    }
    const md = chapterToMarkdown(doc(p(t("a", m("underline")), t("b", m("smallCaps")), t("c", m("superscript")), t("d", m("subscript")))), { htmlMarks: true });
    expect(md).toBe('<u>a</u><span class="small-caps">b</span><sup>c</sup><sub>d</sub>\n');
  });

  it("throws on unknown marks and nodes instead of dropping them", () => {
    expect(() => chapterToMarkdown(doc(p(t("x", { type: "highlight" } as unknown as Mark))))).toThrow(/Unsupported mark type/);
    expect(() => chapterToMarkdown(doc({ type: "mystery" } as unknown as DocNode))).toThrow(/Unsupported node type/);
    expect(() => chapterToMarkdown(doc(p({ type: "mention" } as unknown as DocNode)))).toThrow(/Unsupported node type/);
    expect(() => chapterToMarkdown(doc({ type: "heading", attrs: { level: 4 }, content: [t("x")] }))).toThrow(/levels 1-3/);
    expect(() => chapterToMarkdown(doc({ type: "codeBlock", content: [{ type: "paragraph" }] }))).toThrow(/code block/);
    expect(() => chapterToMarkdown(doc({ type: "image", attrs: { src: "assets/a.png?x" } }))).toThrow(MarkdownExportError);
    expect(() => chapterToMarkdown(doc(p(t("a\nb"))))).toThrow(/line break/);
  });
});

describe("escaping", () => {
  const NASTY = [
    "*not bold* and _not italic_ and `not code`",
    "[not a link](http://x.com) and ![not an image](a.png)",
    "<b>not html</b> &amp; &copy; &#35; AT&T",
    "back\\slash \\* \\\\",
    "~~not strike~~ ~one~",
    "a | b",
    "https://example.com and www.example.com and me@example.com",
    "[^1] and [^note]: x",
  ];
  it.each(NASTY)("round-trips %j verbatim", (text) => {
    const d = doc(p(t(`x ${text} y`)));
    expect(roundTrip(d)).toEqual(d);
  });

  const STARTS = ["# not a heading", "#", "> not a quote", "- not a list", "-", "+ plus", "1. one", "12) twelve", "--- not a rule", "=== eq", "* star", "_ under", "``` fence", "~~~ tilde", "| pipe |", "[^1]: def"];
  it.each(STARTS)("keeps a paragraph that starts with %j a paragraph", (text) => {
    const d = doc(p(t(text)), p(t("after")));
    expect(roundTrip(d)).toEqual(d);
  });

  it("escapes a trailing # in headings and line-start syntax in footnotes, list items and quotes", () => {
    const d = doc(
      { type: "heading", attrs: { level: 2 }, content: [t("Issue #")] },
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("# item"))] }] },
      { type: "blockquote", content: [p(t("- quoted"))] },
      p(t("n"), { type: "footnote", content: [t("- note")] }),
    );
    expect(roundTrip(d)).toEqual(d);
  });
});

describe("htmlMarks round trip", () => {
  const read = (md: string): ChapterDoc => {
    const r = importMarkdown(md);
    expect(r.warnings.filter((w) => w.code !== "no-headings"), md).toEqual([]);
    const out = r.chapters.length === 1 ? r.chapters[0]!.doc : { type: "doc" as const, content: r.chapters.flatMap((c) => c.doc.content) };
    assertChapterDoc(out);
    return unlink(out) as ChapterDoc;
  };

  it("importMarkdown reads the four HTML mark tags back into the same doc", () => {
    const d = doc(
      p(t("plain "), t("under", m("underline")), t(" "), t("caps", m("smallCaps")), t(" x"), t("2", m("superscript")), t(" H"), t("2", m("subscript")), t("O")),
      p(t("bold under", m("bold"), m("underline")), t(" "), t("ital caps", m("italic"), m("smallCaps"))),
      p(t("link", m("link", "https://a.test/")), t(" "), t("linked sup", m("link", "https://a.test/"), m("bold"), m("superscript"))),
    );
    expect(read(chapterToMarkdown(d, { htmlMarks: true }))).toEqual(d);
  });

  it("sample-chapter.json keeps its text and every mark with htmlMarks (the exporter moves marked edge spaces outside the tags)", () => {
    const d = unlink(sample()) as ChapterDoc;
    const out = read(chapterToMarkdown(d, { htmlMarks: true }));
    const flat = (x: DocNode): string => (x.type === "text" ? x.text : "content" in x ? (x.content ?? []).map(flat).join("") : "");
    const marked = (x: ChapterDoc) => JSON.stringify(x).match(/"type":"(underline|smallCaps|superscript|subscript)"/g) ?? [];
    expect(flat(out as unknown as DocNode)).toBe(flat(d as unknown as DocNode));
    expect(new Set(marked(out))).toEqual(new Set(marked(d)));
    expect(marked(out).length).toBeGreaterThan(0);
  });
});

describe("round trip of the fixtures", () => {
  it("sample-chapter.json without the marks that have no syntax comes back identical", () => {
    const d = normalised(sample());
    expect(roundTrip(d)).toEqual(d);
  });

  it("sample-chapter.json cannot be written without htmlMarks (small caps, super- and subscript)", () => {
    expect(() => chapterToMarkdown(sample())).toThrow(/htmlMarks/);
    const md = chapterToMarkdown(sample(), { htmlMarks: true });
    expect(md).toContain('<span class="small-caps">Two</span> [link]');
    expect(md).toContain("H<sub>2</sub>O x<sup>2</sup>");
  });

  it("every chapter of full-book.json is valid Markdown input that re-imports without loss (modulo the lossy marks)", () => {
    for (const c of fullBook().chapters) {
      const d = normalised(c.doc);
      const md = chapterToMarkdown(d, { imageBase: "" });
      const r = importMarkdown(md);
      for (const w of r.warnings) expect(["no-headings", "remote-image", "line-break"], `${c.title}: ${w.message}`).toContain(w.code);
      const wasImage = JSON.stringify(c.doc).includes('"image"');
      if (!wasImage) expect(r.chapters.flatMap((x) => x.doc.content).map(unlink), c.title).toEqual(d.content);
    }
  });
});

// A seeded property test: random documents built from awkward text and the marks that have syntax.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: doc -> markdown -> importer -> doc", () => {
  const WORDS = ["a", "word", "x1", "*", "_", "`", "[", "]", "<", ">", "&", "&amp;", "\\", "#", "-", "+", "1.", "|", "~", "!", "(", ")", "é", "'", '"'];
  it("1000 random paragraphs, lists and quotes survive", () => {
    const rand = rng(42);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const words = (n: number, edge: boolean): string => {
      // Marked runs start and end with a letter (delimiter next to punctuation is a CommonMark flanking corner we do not promise).
      let s = "";
      for (let i = 0; i < n; i++) s += (i ? " " : "") + (edge && (i === 0 || i === n - 1) ? pick(["a", "word", "x1"]) : pick(WORDS));
      return s;
    };
    const inlineContent = (): DocNode[] => {
      const out: DocNode[] = [];
      const runs = 1 + Math.floor(rand() * 4);
      for (let i = 0; i < runs; i++) {
        const kind = pick(["plain", "plain", "bold", "italic", "strike", "bolditalic", "code", "link", "boldlink"]);
        const first = i === 0;
        const last = i === runs - 1;
        if (kind === "plain") {
          const text = words(1 + Math.floor(rand() * 3), false);
          out.push(t(first ? `a ${text}` : last ? `${text} a` : text));
        } else if (kind === "code") out.push(t(words(1 + Math.floor(rand() * 2), false).trim() || "c", m("code")));
        else {
          const marks: Mark[] = kind === "bold" ? [m("bold")] : kind === "italic" ? [m("italic")] : kind === "strike" ? [m("strike")] : kind === "bolditalic" ? [m("bold"), m("italic")] : kind === "link" ? [m("link", "https://example.com/p?q=1&r=(2)")] : [m("link", "https://example.com/"), m("bold")];
          out.push(t(words(1 + Math.floor(rand() * 3), true), ...marks));
        }
        // Separate runs with a plain space when the neighbour is also plain, so merged text is predictable.
        if (!last && rand() < 0.5) out.push(t(" "));
      }
      return merge(out);
    };
    for (let i = 0; i < 1000; i++) {
      const para = (): DocNode => p(...inlineContent());
      const kind = pick(["p", "p", "list", "quote", "olist"]);
      const node: DocNode =
        kind === "p" ? para() : kind === "quote" ? { type: "blockquote", content: [para(), para()] } : { type: kind === "list" ? "bulletList" : "orderedList", content: [{ type: "listItem", content: [para(), { type: "bulletList", content: [{ type: "listItem", content: [para()] }] }] }, { type: "listItem", content: [para()] }] };
      const d = doc(node);
      const md = chapterToMarkdown(d);
      const r = importMarkdown(md);
      expect(r.warnings.filter((w) => w.code !== "no-headings"), md).toEqual([]);
      expect(r.chapters[0]!.doc, md).toEqual({ type: "doc", content: [node] });
    }
  });
});

describe("multi-chapter output", () => {
  const ch = (title: string, body = "text", withHeading = true): { title: string; doc: ChapterDoc } => ({ title, doc: doc(...(withHeading ? [{ type: "heading", attrs: { level: 1 }, content: [t(title)] } as DocNode] : []), p(t(body))) });

  it("returns one string per chapter, adds # Title only when the doc has no level-1 heading, and orders front/chapter/back", () => {
    const parts = chaptersToMarkdown({ title: "Book" }, [
      { ...ch("Appendix", "z"), section: "back", kind: "custom" },
      { ...ch("One", "1") },
      { ...ch("Foreword", "f", false), section: "front", kind: "foreword" },
    ]);
    expect(parts).toEqual(["# Foreword\n\nf\n", "# One\n\n1\n", "# Appendix\n\nz\n"]);
  });

  it("bookToMarkdown joins them so the importer splits the chapters again", () => {
    const md = bookToMarkdown({ title: "Book" }, [ch("One", "1"), ch("Two", "2", false)]);
    expect(md).toBe("# One\n\n1\n\n# Two\n\n2\n");
    const r = importMarkdown(md);
    expect(r.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
  });

  it("exports the whole of full-book.json (small caps etc. as HTML)", () => {
    const book = fullBook();
    const md = bookToMarkdown({ title: "x" }, book.chapters, { htmlMarks: true });
    expect(importMarkdown(md).chapters.length).toBe(book.chapters.length);
  });
});

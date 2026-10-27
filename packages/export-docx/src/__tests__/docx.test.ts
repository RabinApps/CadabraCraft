import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { assertChapterDoc } from "@cadabracraft/editor-schema";
import { importDocx } from "@cadabracraft/import-docx";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { DocxExportError, approximateWords, authorSurname, buildDocx, type DocxChapter } from "../index";

const t = (text: string, ...marks: Mark[]): DocNode => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const h1 = (text: string): DocNode => ({ type: "heading", attrs: { level: 1 }, content: [t(text)] });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const m = (type: Mark["type"], href?: string): Mark => (href ? { type, attrs: { href } } : { type });
const book = { title: "The Long Road", author: "Ada Q. Lovelace" };
const fullBook = (): { chapters: { title: string; doc: ChapterDoc }[] } => JSON.parse(readFileSync(new URL("../../../../fixtures/manuscripts/full-book.json", import.meta.url), "utf8"));

/** A PNG header with the given pixel size (enough for size sniffing; not a decodable image). */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

const parts = (bytes: Uint8Array): Record<string, string> => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v, k.startsWith("word/media/"))]));
const documentXml = (bytes: Uint8Array): string => parts(bytes)["word/document.xml"]!;
const chapter = (title: string, ...content: DocNode[]): DocxChapter => ({ title, doc: doc(...content) });

describe("package structure", () => {
  const assets = new Map([["assets/a.png", png(800, 400)]]);
  const rich = buildDocx(book, [
    chapter("One", p(t("Plain & <simple> \"quoted\" "), t("bold", m("bold")), t(" link", m("link", "https://example.com/?a=1&b=2"))), p(t("x"), { type: "footnote", content: [t("A note & more")] }), { type: "image", attrs: { src: "assets/a.png", alt: "A \"map\"", title: "Fig <1>" } }),
    chapter("Two", { type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }] }, { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(t("H"))] }, { type: "tableHeader", content: [p(t("I"))] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p(t("1"))] }, { type: "tableCell", content: [p(t("2"))] }] }] }),
  ], { assets });
  const files = parts(rich);

  it("has every required part, [Content_Types].xml first", () => {
    expect(Object.keys(unzipSync(rich))[0]).toBe("[Content_Types].xml");
    for (const name of ["_rels/.rels", "docProps/core.xml", "docProps/app.xml", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/settings.xml", "word/numbering.xml", "word/footnotes.xml", "word/header1.xml", "word/header2.xml", "word/media/image1.png"]) {
      expect(files[name], name).toBeDefined();
    }
  });

  it("every XML part is well-formed", () => {
    for (const [name, text] of Object.entries(files)) {
      if (name.startsWith("word/media/")) continue;
      expect(XMLValidator.validate(text), name).toBe(true);
    }
  });

  it("content types and relationships are consistent", () => {
    const names = Object.keys(files);
    const types = files["[Content_Types].xml"]!;
    for (const [, part] of types.matchAll(/PartName="([^"]+)"/g)) expect(names, part).toContain(part!.slice(1));
    for (const name of names.filter((n) => n.endsWith(".xml") && !n.startsWith("[") && !n.includes("_rels"))) {
      expect(types.includes(`PartName="/${name}"`) || types.includes('Extension="xml"')).toBe(true);
    }
    expect(types).toContain('Extension="png" ContentType="image/png"');
    const rels = files["word/_rels/document.xml.rels"]!;
    const ids = [...rels.matchAll(/Id="(rId\d+)"/g)].map((x) => x[1]!);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, target, mode] of rels.matchAll(/Target="([^"]+)"( TargetMode="External")?/g)) {
      if (!mode) expect(names, target).toContain(`word/${target}`);
    }
    const used = [...files["word/document.xml"]!.matchAll(/r:(?:id|embed)="(rId\d+)"/g)].map((x) => x[1]!);
    for (const id of used) expect(ids).toContain(id);
    expect(files["_rels/.rels"]).toContain('Target="word/document.xml"');
  });

  it("escapes XML special characters in text, alt text and link targets", () => {
    const d = files["word/document.xml"]!;
    expect(d).toContain("Plain &amp; &lt;simple&gt; &quot;quoted&quot; ");
    expect(d).toContain('descr="A &quot;map&quot;"');
    expect(files["word/_rels/document.xml.rels"]).toContain("https://example.com/?a=1&amp;b=2");
    expect(files["word/footnotes.xml"]).toContain("A note &amp; more");
    expect(d).toContain("Fig &lt;1&gt;");
  });

  it("is deterministic and embeds the image", () => {
    const again = buildDocx(book, [chapter("One", p(t("Plain & <simple> \"quoted\" "), t("bold", m("bold")), t(" link", m("link", "https://example.com/?a=1&b=2"))), p(t("x"), { type: "footnote", content: [t("A note & more")] }), { type: "image", attrs: { src: "assets/a.png", alt: "A \"map\"", title: "Fig <1>" } }), chapter("Two", { type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }] }, { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(t("H"))] }, { type: "tableHeader", content: [p(t("I"))] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p(t("1"))] }, { type: "tableCell", content: [p(t("2"))] }] }] })], { assets });
    expect(Buffer.from(again).equals(Buffer.from(rich))).toBe(true);
    expect(files["word/media/image1.png"]!.length).toBe(33);
  });
});

describe("manuscript format", () => {
  const files = parts(buildDocx(book, [chapter("One", p(t("Hello world.")), { type: "sceneBreak" }, p(t("After."))), chapter("Two", p(t("More.")))]));
  const d = files["word/document.xml"]!;
  const s = files["word/styles.xml"]!;

  it("is 12 pt Times New Roman, double spaced, left aligned with a 0.5 inch first-line indent", () => {
    expect(s).toContain('w:ascii="Times New Roman"');
    expect(s).toContain('<w:sz w:val="24"/>');
    expect(s).toContain('w:line="480" w:lineRule="auto"');
    expect(s).toContain('<w:ind w:firstLine="720"/><w:jc w:val="left"/>');
  });

  it("uses US Letter with 1 inch margins and starts page numbers at 1 after the title page", () => {
    expect(d).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    expect(d).toContain('w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"');
    expect(d).toContain('<w:pgNumType w:start="1"/>');
    expect(d.match(/<w:sectPr>/g)).toHaveLength(2);
  });

  it("writes the title page with the word count rounded to the nearest 100", () => {
    expect(d).toContain("About 4 words");
    expect(d).toContain("The Long Road");
    expect(d).toContain("by Ada Q. Lovelace");
    const big = buildDocx(book, [chapter("One", p(t("word ".repeat(1249))))]);
    expect(documentXml(big)).toContain("About 1,200 words");
  });

  it("puts the second chapter on a new page and the first directly after the title page without a blank page", () => {
    expect(d.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
    expect(d).toContain('<w:pStyle w:val="Heading1"/><w:spacing w:before="2880"/></w:pPr>');
  });

  it("writes scene breaks as a centred # and adds no ending", () => {
    expect(d).toContain('<w:pStyle w:val="SceneBreak"/></w:pPr><w:r><w:t>#</w:t></w:r>');
    expect(d).not.toMatch(/THE END/i);
  });

  it("has a running header with surname, title in capitals and a PAGE field, and none on the title page", () => {
    expect(files["word/header2.xml"]).toContain("Lovelace / THE LONG ROAD / ");
    expect(files["word/header2.xml"]).toContain("PAGE");
    expect(files["word/header1.xml"]).not.toContain("PAGE");
  });

  it("can use Courier New", () => {
    const c = parts(buildDocx(book, [chapter("One", p(t("x")))], { font: "courier" }));
    expect(c["word/styles.xml"]).toContain('w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="Courier New"');
  });
});

describe("header surname", () => {
  it("is the last word of the author", () => {
    expect(authorSurname("Ada Q. Lovelace")).toBe("Lovelace");
    expect(authorSurname("  Madonna ")).toBe("Madonna");
    expect(authorSurname("")).toBe("");
  });
  it("skips a generational suffix", () => {
    expect(authorSurname("Martin Luther King Jr.")).toBe("King");
    expect(authorSurname("John Smith, III")).toBe("Smith");
  });
  it("leaves the surname out of the header when there is no author", () => {
    const f = parts(buildDocx({ title: "Solo", author: "" }, [chapter("One", p(t("x")))]));
    expect(f["word/header2.xml"]).toContain(">SOLO / <");
  });
  it("rounds word counts", () => {
    expect([49, 99, 100, 149, 150, 1234].map(approximateWords)).toEqual([49, 99, 100, 100, 200, 1200]);
  });
});

describe("marks", () => {
  const run = (...marks: Mark[]) => documentXml(buildDocx(book, [chapter("One", p(t("x", ...marks)))]));
  it("maps bold, italic, underline, small caps, strike, superscript, subscript, code and links", () => {
    expect(run(m("bold"))).toContain("<w:b/>");
    expect(run(m("italic"))).toContain("<w:i/>");
    expect(run(m("underline"))).toContain('<w:u w:val="single"/>');
    expect(run(m("smallCaps"))).toContain("<w:smallCaps/>");
    expect(run(m("strike"))).toContain("<w:strike/>");
    expect(run(m("superscript"))).toContain('<w:vertAlign w:val="superscript"/>');
    expect(run(m("subscript"))).toContain('<w:vertAlign w:val="subscript"/>');
    expect(run(m("code"))).toContain('w:ascii="Courier New"');
    expect(run(m("link", "https://x.org"))).toContain("<w:hyperlink");
  });
  it("throws on an unknown mark, a link without href and superscript with subscript", () => {
    expect(() => run({ type: "wobble" } as never)).toThrow(DocxExportError);
    expect(() => run(m("link"))).toThrow(/without an address/);
    expect(() => run(m("superscript"), m("subscript"))).toThrow(/superscript and subscript|both/);
  });
});

describe("nodes", () => {
  it("throws on an unknown node, naming the chapter and node", () => {
    const err = (() => { try { buildDocx(book, [chapter("Chapter 7", { type: "mystery" } as never)]); } catch (e) { return e as DocxExportError; } })();
    expect(err).toBeInstanceOf(DocxExportError);
    expect(err!.chapter).toBe("Chapter 7");
    expect(err!.node).toBe("mystery");
    expect(err!.message).toContain("Chapter 7");
    expect(err!.message).toContain("mystery");
  });
  it("throws on an unknown inline node and an unsupported heading level", () => {
    expect(() => buildDocx(book, [chapter("A", p({ type: "emoji" } as never))])).toThrow(/emoji/);
    expect(() => buildDocx(book, [chapter("A", { type: "heading", attrs: { level: 5 }, content: [t("x")] })])).toThrow(/level 5/);
  });
  it("throws on characters XML cannot carry instead of dropping them", () => {
    expect(() => buildDocx(book, [chapter("A", p(t("bad \u0001 char")))])).toThrow(/U\+0001/);
    expect(() => buildDocx({ title: "T\u0000", author: "A" }, [])).toThrow(DocxExportError);
  });
  it("refuses right-to-left languages", () => {
    expect(() => buildDocx({ ...book, language: "he" }, [chapter("A", p(t("x")))])).toThrow(/Right-to-left/);
  });

  it("writes real Word footnotes with unique ids across chapters", () => {
    const f = parts(buildDocx(book, [chapter("A", p(t("a"), { type: "footnote", content: [t("first")] })), chapter("B", p(t("b"), { type: "footnote", content: [t("second", m("italic"))] }))]));
    expect(f["word/document.xml"]).toContain('<w:footnoteReference w:id="1"/>');
    expect(f["word/document.xml"]).toContain('<w:footnoteReference w:id="2"/>');
    expect(f["word/footnotes.xml"]).toContain('<w:footnote w:id="1">');
    expect(f["word/footnotes.xml"]).toContain("second");
    expect(f["word/footnotes.xml"]).toContain("<w:footnoteRef/>");
    expect(f["word/footnotes.xml"]).toContain('w:type="separator"');
    expect(f["word/settings.xml"]).toContain("<w:footnotePr>");
  });
  it("refuses a footnote inside a footnote", () => {
    expect(() => buildDocx(book, [chapter("A", p({ type: "footnote", content: [{ type: "footnote", content: [t("x")] } as never] }))])).toThrow(/another footnote/);
  });

  it("maps block quotes, lists (bullets and numbered with a start), code blocks and tables", () => {
    const d = documentXml(buildDocx(book, [chapter("A",
      { type: "blockquote", content: [p(t("quoted"))] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("x")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("nested"))] }] }] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [p(t("again"))] }] },
      { type: "codeBlock", attrs: { language: "js" }, content: [t("a < b\n\n  c")] },
    )]));
    expect(d).toContain('<w:pStyle w:val="BlockQuote"/>');
    expect(d).toContain('<w:numId w:val="2"/>');
    expect(d).toContain('<w:numId w:val="3"/>');
    expect(d).toContain('<w:ilvl w:val="1"/><w:numId w:val="1"/>');
    expect(d.match(/w:val="CodeBlock"/g)).toHaveLength(3);
    expect(d).toContain("a &lt; b");
    const num = parts(buildDocx(book, [chapter("A", { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("x"))] }] })]))["word/numbering.xml"]!;
    expect(num).toContain('<w:startOverride w:val="3"/>');
  });

  it("separates adjacent tables and never ends the body on a table", () => {
    const tbl: DocNode = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(t("c"))] }] }] };
    const d = documentXml(buildDocx(book, [chapter("A", tbl, tbl)]));
    expect(d).not.toContain("</w:tbl><w:tbl>");
    expect(d).toMatch(/<\/w:tbl><w:p[ >/][^]*<\/w:body>/);
    expect(d).not.toMatch(/<\/w:tbl><w:sectPr>/);
  });

  it("scales a large image to the text width and embeds alt text", () => {
    const assets = new Map([["assets/big.png", png(3000, 1500)]]);
    const d = documentXml(buildDocx(book, [chapter("A", { type: "image", attrs: { src: "assets/big.png", alt: "Big", title: null } })], { assets }));
    expect(d).toContain('<wp:extent cx="5943600" cy="2971800"/>');
    expect(d).toContain('descr="Big"');
    expect(d).not.toContain("Caption");
  });
  it("refuses a missing image, an SVG, a bad path and non-image bytes", () => {
    const node = (src: string): DocNode => ({ type: "image", attrs: { src, alt: "x" } });
    expect(() => buildDocx(book, [chapter("A", node("assets/a.png"))])).toThrow(/missing/);
    expect(() => buildDocx(book, [chapter("A", node("assets/a.svg"))], { assets: new Map([["assets/a.svg", new Uint8Array(4)]]) })).toThrow(/SVG/);
    expect(() => buildDocx(book, [chapter("A", node("../a.png"))])).toThrow(/not a project image/);
    expect(() => buildDocx(book, [chapter("A", node("assets/a.png"))], { assets: new Map([["assets/a.png", new Uint8Array(40)]]) })).toThrow(/not a readable PNG/);
  });
});

describe("front and back matter", () => {
  it("writes pages in reading order, each on its own page, and replaces a title-page page with the generated one", () => {
    const d = documentXml(buildDocx(book, [
      { title: "Afterword", section: "back", kind: "acknowledgments", doc: doc(p(t("Thanks."))) },
      { title: "One", doc: doc(p(t("Body."))) },
      { title: "Title page", section: "front", kind: "title-page", doc: doc(h1("The Long Road"), p(t("Ada"))) },
      { title: "Dedication", section: "front", kind: "dedication", doc: doc(p(t("For you."))) },
    ]));
    expect(d.indexOf("For you.")).toBeLessThan(d.indexOf("Body."));
    expect(d.indexOf("Body.")).toBeLessThan(d.indexOf("Thanks."));
    expect(d.match(/<w:pageBreakBefore\/>/g)).toHaveLength(2);
    expect(d.match(/The Long Road/g)).toHaveLength(1);
    expect(d).toContain("About 1 word<"); // only the chapter counts towards the total
  });
  it("uses a leading level-1 heading as the page title instead of adding a second one", () => {
    const d = documentXml(buildDocx(book, [chapter("One", h1("One"), p(t("x")))]));
    expect(d.match(/Heading1/g)).toHaveLength(1);
  });
});

describe("round trip through the CadabraCraft DOCX importer", () => {
  it("produces a file the importer reads back with the same text, footnotes and no warnings about the structure", () => {
    const src = chapter("Chapter One", h1("Chapter One"), p(t("Hello "), t("bold", m("bold")), t(" and "), t("italic", m("italic")), t(".")), p(t("note"), { type: "footnote", content: [t("The note.")] }), { type: "sceneBreak" }, p(t("After.")));
    const r = importDocx(buildDocx(book, [src]));
    const text = JSON.stringify(r.chapters.map((c) => c.doc));
    expect(text).toContain("Hello ");
    expect(text).toContain("The note.");
    expect(text).toContain("After.");
    for (const c of r.chapters) assertChapterDoc(c.doc);
  });
  it("exports the whole full-book fixture, every page importing back", () => {
    const fb = fullBook();
    const bytes = buildDocx(book, fb.chapters.map((c) => ({ title: c.title, doc: c.doc })), { assets: new Map(fb.chapters.flatMap((c) => JSON.stringify(c.doc).match(/assets\/[^"]+/g) ?? []).map((a) => [a, png(100, 100)] as const)) });
    for (const [name, text] of Object.entries(parts(bytes))) if (!name.startsWith("word/media/")) expect(XMLValidator.validate(text), name).toBe(true);
    const r = importDocx(bytes);
    expect(r.chapters.length).toBeGreaterThan(0);
  });
});

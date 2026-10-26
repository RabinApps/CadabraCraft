import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { getTemplate, listTemplates } from "@cadabracraft/templates";
import { FontNotAvailableError, MissingAssetError, PdfExportError } from "./errors";
import { HOSTILE } from "./hostile";
import { buildTypst, buildTypstDocument, resolveFonts } from "./typst";
import { loadFullBook } from "./fixtures";
import type { PdfChapter } from "./types";

const book = { title: "Sample Book", author: "Test Author", language: "en" };
const sample: ChapterDoc = JSON.parse(
  readFileSync(new URL("../../../fixtures/manuscripts/sample-chapter.json", import.meta.url), "utf8"),
);
const ch = (...content: DocNode[]): PdfChapter[] => [{ id: "c", title: "C", doc: { type: "doc", content } }];
const text = (t: string, marks?: { type: "bold" | "italic" | "underline" | "smallCaps" | "link"; attrs?: { href?: string } }[]): DocNode => ({
  type: "text", text: t, ...(marks ? { marks } : {}),
});
const para = (...c: DocNode[]): DocNode => ({ type: "paragraph", content: c });

describe("golden Typst source", () => {
  // Update procedure: UPDATE_GOLDEN=1 pnpm --filter @cadabracraft/export-pdf test, then review `git diff fixtures/golden`.
  const goldenUrl = new URL("../../../fixtures/golden/sample-chapter.typ", import.meta.url);
  it("matches fixtures/golden/sample-chapter.typ", () => {
    const actual = buildTypst(book, [{ id: "ch1", title: "Chapter One", doc: sample }]);
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(goldenUrl, actual);
    expect(actual).toBe(readFileSync(goldenUrl, "utf8"));
  });
});

describe("buildTypst content", () => {
  const src = buildTypst(book, [{ id: "ch1", title: "Chapter One", doc: sample }]);

  it("is deterministic", () => {
    expect(buildTypst(book, [{ id: "ch1", title: "Chapter One", doc: sample }])).toBe(src);
  });
  it("renders marks, footnotes, quotes, scene breaks and lists", () => {
    expect(src).toContain("#strong[bright]");
    expect(src).toContain("#emph[striking]");
    expect(src).toContain("#footnote[Orwell, 1949.]\\.");
    expect(src).toContain("#quote(block: true)[");
    expect(src).toContain("A quoted \\<line\\>.");
    expect(src).toContain("#scene-break()");
    expect(src).toContain("#heading(level: 2)[A Section]");
    expect(src).toContain("#list(");
    expect(src).toContain("#smallcaps[Two ]");
    expect(src).toContain('#link("https://example.com/?a=1&b=2")[link]');
    expect(src).toContain('#chapter-start("Chapter One", 1)');
  });
  it("renders ordered and nested lists", () => {
    const item = (t: string, ...extra: DocNode[]): DocNode => ({ type: "listItem", content: [para(text(t)), ...extra] });
    const out = buildTypst(book, ch({ type: "orderedList", attrs: { start: 3 }, content: [item("a", { type: "bulletList", content: [item("b")] })] }));
    expect(out).toMatch(/#enum\(start: 3, \n {2}\[\na\n\n#list\(\n {2}\[\nb\n {2}\],\n\)\n {2}\],\n\)/);
  });
  it("starts every chapter via chapter-start and numbers them", () => {
    const { book: b, chapters } = loadFullBook();
    const out = buildTypst(b, chapters);
    expect(out.match(/#chapter-start\(/g)).toHaveLength(chapters.length);
    expect(out).toContain('#chapter-start("Afterword", 4)');
    expect(out).toContain('lang: "en", region: "GB"');
  });
  it("makes only http(s) and mailto links; others keep their text", () => {
    const out = buildTypst(book, ch(para(
      text("ok", [{ type: "link", attrs: { href: "mailto:a@b.test" } }]),
      text(" bad", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
      text(" none", [{ type: "link", attrs: {} }]),
    )));
    expect(out).toContain('#link("mailto:a@b.test")[ok]');
    expect(out).not.toContain("javascript");
    expect(out).toContain(" bad none");
  });
  it("stacks marks", () => {
    const out = buildTypst(book, ch(para(text("x", [{ type: "bold" }, { type: "italic" }, { type: "underline" }]))));
    expect(out).toContain("#underline[#emph[#strong[x]]]");
  });
  it("skips empty paragraphs and empty text", () => {
    const out = buildTypst(book, ch(para(), para(text("")), para(text("kept"))));
    expect(out).toContain("kept");
    expect(out.split("#chapter-start")[1]).not.toMatch(/\n\n\n\n/);
  });
});

describe("escaping inside documents", () => {
  it("never leaks hostile text as markup", () => {
    const out = buildTypst(book, ch(...HOSTILE.map((h) => para(text(h)))));
    const body = out.slice(out.indexOf("#chapter-start"));
    // Every hostile line is present only in escaped form.
    expect(body).not.toMatch(/(^|[^\\])#let x/);
    expect(body).not.toContain("\n= not");
    expect(body).not.toContain("\n== not");
    expect(body).not.toContain("\n- not");
    expect(body).not.toContain("\n+ not");
    expect(body).not.toContain("\n1. not");
    expect(body).not.toContain("\n/ term");
    expect(body).not.toMatch(/(^|[^\\])\/\//m);
    expect(body).toContain("\\#let x = 1");
    expect(body).toContain("\\= not a heading");
    expect(body).toContain("1\\. not numbered");
  });
  it("escapes titles, link urls, captions and alt text", () => {
    const out = buildTypst(
      { title: 'He said "#hi"\\', author: "A $ B", language: "en" },
      [{ id: "c", title: 'Ch "1" \\ #x', doc: { type: "doc", content: [
        para(text("l", [{ type: "link", attrs: { href: 'https://x.test/"quote' } }])),
        { type: "image", attrs: { src: "a.png", alt: 'alt "x"', title: "Cap #1 *b*" } },
      ] } }],
    );
    expect(out).toContain('#let book-title = "He said \\"#hi\\"\\\\"');
    expect(out).toContain('author: "A $ B"');
    expect(out).toContain('#chapter-start("Ch \\"1\\" \\\\ #x", 1)');
    expect(out).toContain('#link("https://x.test/\\"quote")[l]');
    expect(out).toContain('"alt \\"x\\""');
    expect(out).toContain("caption: [Cap \\#1 \\*b\\*]");
  });
  it("protects text right after an inline call", () => {
    const out = buildTypst(book, ch(para(text("a", [{ type: "bold" }]), text(".b (c)"))));
    expect(out).toContain("#strong[a]\\.b (c)");
  });
});

describe("unsupported input", () => {
  it("throws on unknown node types instead of dropping them", () => {
    expect(() => buildTypst(book, ch({ type: "figcaption" }))).toThrow(PdfExportError);
    expect(() => buildTypst(book, ch({ type: "figcaption" }))).toThrow(/Unsupported node type in chapter: figcaption/);
    expect(() => buildTypst(book, ch({ type: "table" } as unknown as DocNode))).toThrow(/table/);
    expect(() => buildTypst(book, ch(para({ type: "hardBreak" } as unknown as DocNode)))).toThrow(/hardBreak/);
  });
  it("throws on unknown marks", () => {
    expect(() => buildTypst(book, ch(para(text("x", [{ type: "strike" } as never]))))).toThrow(/strike/);
  });
  it("throws on nested footnotes and unsupported image types", () => {
    const fn = (...c: DocNode[]): DocNode => ({ type: "footnote", content: c });
    expect(() => buildTypst(book, ch(para(fn(fn(text("x"))))))).toThrow(/nested/);
    expect(() => buildTypst(book, ch({ type: "image", attrs: { src: "a.bmp" } }))).toThrow(/Unsupported image type/);
    expect(() => buildTypst(book, ch({ type: "image", attrs: { src: "" } }))).toThrow(/without a source/);
  });
  it("rejects bad geometry and unknown templates", () => {
    expect(() => buildTypst(book, ch(), { margins: { inside: 5 } })).toThrow(/margin/);
    expect(() => buildTypst(book, ch(), { margins: { inside: 3, outside: 3 } })).toThrow(/too little room/);
    expect(() => buildTypst(book, ch(), { trimSize: "7x10" as never })).toThrow(/trim size/);
    expect(() => buildTypst(book, ch(), { template: "nope" })).toThrow(/Unknown template/);
    expect(() => buildTypst(book, ch(), { fontSizePt: 2 })).toThrow(/font size/);
  });
});

describe("images", () => {
  const img: DocNode = { type: "image", attrs: { src: "pics/cover.JPEG", alt: "Cover", title: "The cover" } };
  it("maps sources to deterministic relative asset paths", () => {
    const doc = buildTypstDocument(book, ch(img, img, { type: "image", attrs: { src: "b.svg" } }));
    expect([...doc.images]).toEqual([["pics/cover.JPEG", "assets/img-1.jpg"], ["b.svg", "assets/img-2.svg"]]);
    expect(doc.source).toContain('fit-image("assets/img-1.jpg", "Cover"');
    expect(doc.source).toContain("caption: [The cover]");
  });
  it("never uses the original src as a file path", () => {
    const doc = buildTypstDocument(book, ch({ type: "image", attrs: { src: "../../etc/passwd.png" } }));
    expect(doc.source).not.toContain("etc/passwd");
  });
  it("checks supplied assets", () => {
    expect(() => buildTypst(book, ch(img), { assets: {} })).toThrow(MissingAssetError);
    expect(() => buildTypst(book, ch(img), { assets: { "pics/cover.JPEG": new Uint8Array([1]) } })).not.toThrow();
  });
});

describe("page setup options", () => {
  const page = (o: Parameters<typeof buildTypst>[2]): string => buildTypst(book, ch(), o).split("#set text")[0]!;
  it("supports the three trim sizes", () => {
    expect(page({ trimSize: "5x8" })).toContain("width: 5in, height: 8in");
    expect(page({ trimSize: "5.5x8.5" })).toContain("width: 5.5in, height: 8.5in");
    expect(page({ trimSize: "6x9" })).toContain("width: 6in, height: 9in");
  });
  it("mirrors margins (inside/outside) by default and can use left/right", () => {
    expect(page({ margins: { inside: 1, outside: 0.5 } })).toContain("inside: 1in, outside: 0.5in");
    const flat = page({ mirrored: false, margins: { inside: 1, outside: 0.5 } });
    expect(flat).toContain("left: 1in, right: 0.5in");
    expect(flat).not.toContain("inside:");
  });
  it("toggles page numbers and running headers", () => {
    const on = page({});
    expect(on).toContain("counter(page).display()");
    expect(on).toContain('state("chapter-title").get()');
    expect(on).toContain("book-title");
    const off = page({ pageNumbers: false, runningHeaders: false });
    expect(off).toContain("header: none");
    expect(off).toContain("footer: none");
  });
  it("chapter opening: recto for novel, any for modern, overridable", () => {
    expect(buildTypst(book, ch())).toContain('pagebreak(weak: true, to: "odd")');
    expect(buildTypst(book, ch(), { template: "modern" })).not.toContain('to: "odd"');
    expect(buildTypst(book, ch(), { template: "modern", chapterStart: "recto" })).toContain('to: "odd"');
    expect(buildTypst(book, ch(), { chapterStart: "any" })).not.toContain('to: "odd"');
  });
  it("every template produces a source with its own settings", () => {
    for (const t of listTemplates()) {
      const out = buildTypst(book, ch(para(text("x"))), { template: t.id });
      expect(out).toContain(`Template: ${t.id}.`);
      expect(out).toContain(`size: ${t.print.fontSizePt}pt`);
    }
    expect(buildTypst(book, ch(), { template: "nonfiction" })).toContain('upper("Chapter {n}"');
  });
  it("accepts a template object", () => {
    const t = { ...getTemplate("novel"), id: "custom" };
    expect(buildTypst(book, ch(), { template: t })).toContain("Template: custom.");
  });
  it("embeds the requested fonts", () => {
    const out = buildTypst(book, ch(), { fonts: { body: "Body Font", heading: "Head Font" } });
    expect(out).toContain('#set text(font: "Body Font"');
    expect(out).toContain('font: "Head Font"');
  });
});

describe("resolveFonts", () => {
  it("uses the first available template candidate", () => {
    expect(resolveFonts({ template: "modern" }, ["Arial", "helvetica"]).body).toBe("Helvetica");
    expect(resolveFonts({ template: "modern" }, ["Inter", "Arial"]).body).toBe("Inter");
  });
  it("refuses a missing explicit font and names it, with no fallback", () => {
    const run = (): unknown => resolveFonts({ fonts: { body: "Nonexistent Sans" } }, ["Libertinus Serif"]);
    expect(run).toThrow(FontNotAvailableError);
    expect(run).toThrow(/"Nonexistent Sans" \(body\)/);
  });
  it("refuses a missing heading font", () => {
    expect(() => resolveFonts({ fonts: { heading: "Fancy" } }, ["Libertinus Serif"])).toThrow(/"Fancy" \(heading\)/);
  });
  it("names all candidates when none of a template's fonts exist", () => {
    expect(() => resolveFonts({ template: "modern" }, ["Libertinus Serif"])).toThrow(/Inter.*Helvetica Neue.*Helvetica.*Arial/);
  });
});

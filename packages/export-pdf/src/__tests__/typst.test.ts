import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { getTemplate, listTemplates } from "@cadabracraft/templates";
import { FontNotAvailableError, MissingAssetError, PdfExportError } from "../errors";
import { HOSTILE } from "./hostile";
import { buildTypst, buildTypstDocument, resolveFonts } from "../typst";
import { loadFullBook } from "./fixtures";
import type { PdfChapter } from "../types";

const book = { title: "Sample Book", author: "Test Author", language: "en" };
const sample: ChapterDoc = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/manuscripts/sample-chapter.json", import.meta.url),
    "utf8",
  ),
);
const ch = (...content: DocNode[]): PdfChapter[] => [
  { id: "c", title: "C", doc: { type: "doc", content } },
];
const text = (
  t: string,
  marks?: {
    type:
      | "bold"
      | "italic"
      | "underline"
      | "smallCaps"
      | "strike"
      | "code"
      | "superscript"
      | "subscript"
      | "link"
      | "lang";
    attrs?: { href?: string; lang?: string };
  }[],
): DocNode => ({
  type: "text",
  text: t,
  ...(marks ? { marks } : {}),
});
const para = (...c: DocNode[]): DocNode => ({ type: "paragraph", content: c });

describe("golden Typst source", () => {
  // Update procedure: UPDATE_GOLDEN=1 pnpm --filter @cadabracraft/export-pdf test, then review `git diff fixtures/golden`.
  const goldenUrl = new URL("../../../../fixtures/golden/sample-chapter.typ", import.meta.url);
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
  it("renders tables with a repeating header row and escaped cells", () => {
    expect(src).toContain(
      "#table(\n  columns: (1fr, 1fr),\n  table.header([Item], [Cost & note]),",
    );
    expect(src).toContain("[a\\<b], [Ten#footnote[In cells.]]");
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
    expect(src).toContain('#chapter-start("Chapter One", 1,');
  });
  it("draws the template's chapter ornament above the title, only when it has one", () => {
    expect(buildTypst(book, ch(), { template: "novel" })).toContain(
      'align(center, text(size: 1.2em, "⁂"))',
    );
    expect(buildTypst(book, ch(), { template: "poetry" })).not.toContain("size: 1.2em");
  });
  it("sets the first paragraph of a chapter as a drop cap when the template asks for it", () => {
    const doc = buildTypstDocument(
      book,
      ch(para(text("Once upon a time.")), para(text("Second."))),
      { template: "novel" },
    );
    expect(doc.usesDropCap).toBe(true);
    expect(doc.source).toContain('#import "typst-droplet/lib.typ": dropcap');
    expect(doc.source).toContain("#dropcap(height: 3, gap: 0.12em)[Once upon a time.]");
    const plain = buildTypstDocument(book, ch(para(text("Once upon a time."))), {
      template: "poetry",
    });
    expect(plain.usesDropCap).toBe(false);
    expect(plain.source).not.toContain("dropcap");
  });
  it("lets each chapter turn the drop cap on or off whatever the template says", () => {
    const two = (a?: boolean, b?: boolean): PdfChapter[] => [
      {
        id: "a",
        title: "A",
        doc: { type: "doc", content: [para(text("Alpha opens."))] },
        ...(a === undefined ? {} : { dropCap: a }),
      },
      {
        id: "b",
        title: "B",
        doc: { type: "doc", content: [para(text("Beta opens."))] },
        ...(b === undefined ? {} : { dropCap: b }),
      },
    ];
    const novel = buildTypstDocument(book, two(false), { template: "novel" }).source;
    expect(novel).not.toContain("[Alpha opens.]");
    expect(novel).toContain("#dropcap(height: 3, gap: 0.12em)[Beta opens.]");
    const poetry = buildTypstDocument(book, two(true), { template: "poetry" }).source;
    expect(poetry).toContain("#dropcap(height: 3, gap: 0.12em)[Alpha opens.]");
    expect(poetry).not.toContain("[Beta opens.]");
    expect(buildTypstDocument(book, two(false, false), { template: "novel" }).usesDropCap).toBe(
      false,
    );
  });
  it("never sets a drop cap on a matter page, whatever it says", () => {
    const page: PdfChapter = {
      id: "d",
      title: "D",
      doc: { type: "doc", content: [para(text("For you."))] },
      section: "front",
      kind: "dedication",
      dropCap: true,
    };
    expect(buildTypstDocument(book, [page], { template: "novel" }).usesDropCap).toBe(false);
  });
  it("skips the drop cap when the chapter does not open with a plain-text paragraph", () => {
    expect(
      buildTypstDocument(book, ch(para(text("Bold start", [{ type: "bold" }]))), {
        template: "novel",
      }).usesDropCap,
    ).toBe(false);
    expect(
      buildTypstDocument(book, ch(para(text("1 is not a letter."))), { template: "novel" })
        .usesDropCap,
    ).toBe(false);
  });
  it("renders ordered and nested lists", () => {
    const item = (t: string, ...extra: DocNode[]): DocNode => ({
      type: "listItem",
      content: [para(text(t)), ...extra],
    });
    const out = buildTypst(
      book,
      ch({
        type: "orderedList",
        attrs: { start: 3 },
        content: [item("a", { type: "bulletList", content: [item("b")] })],
      }),
    );
    expect(out).toMatch(
      /#enum\(start: 3, \n {2}\[\na\n\n#list\(\n {2}\[\nb\n {2}\],\n\)\n {2}\],\n\)/,
    );
  });
  it("starts every chapter via chapter-start and numbers them", () => {
    const { book: b, chapters } = loadFullBook();
    const out = buildTypst(b, chapters);
    expect(out.match(/#chapter-start\(/g)).toHaveLength(chapters.length);
    expect(out).toContain('#chapter-start("Afterword", 4,');
    expect(out).toContain('lang: "en", region: "GB"');
  });
  it("makes only http(s) and mailto links; others keep their text", () => {
    const out = buildTypst(
      book,
      ch(
        para(
          text("ok", [{ type: "link", attrs: { href: "mailto:a@b.test" } }]),
          text(" bad", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
          text(" none", [{ type: "link", attrs: {} }]),
        ),
      ),
    );
    expect(out).toContain('#link("mailto:a@b.test")[ok]');
    expect(out).not.toContain("javascript");
    expect(out).toContain(" bad none");
  });
  it("sets the language of a passage with text(lang:, region:), like the book's own", () => {
    const lang = (tag: string) => para(text("bonjour", [{ type: "lang", attrs: { lang: tag } }]));
    expect(buildTypst(book, ch(lang("fr-CA")))).toContain(
      '#text(lang: "fr", region: "CA")[bonjour]',
    );
    expect(buildTypst(book, ch(lang("DE")))).toContain('#text(lang: "de")[bonjour]');
    // A tag with no 2 or 3 letter language keeps its text, unmarked.
    const out = buildTypst(book, ch(lang("x-klingon")));
    expect(out).toContain("bonjour");
    expect(out).not.toContain('#text(lang: "x');
    for (const attrs of [undefined, { lang: 'fr")' }]) {
      expect(() =>
        buildTypst(book, ch(para(text("x", [{ type: "lang", ...(attrs ? { attrs } : {}) }])))),
      ).toThrow(/BCP 47/);
    }
  });
  it("stacks marks", () => {
    const out = buildTypst(
      book,
      ch(para(text("x", [{ type: "bold" }, { type: "italic" }, { type: "underline" }]))),
    );
    expect(out).toContain("#underline[#emph[#strong[x]]]");
  });
  it("skips empty paragraphs and empty text", () => {
    const out = buildTypst(book, ch(para(), para(text("")), para(text("kept"))));
    expect(out).toContain("kept");
    expect(out.split("#chapter-start")[1]).not.toMatch(/\n\n\n\n/);
  });
});

describe("strike, code, superscript, subscript", () => {
  const src = (...c: DocNode[]) => buildTypst(book, ch(para(...c)));
  it("emits Typst calls", () => {
    const out = src(
      text("a", [{ type: "strike" }]),
      text("b", [{ type: "superscript" }]),
      text("c", [{ type: "subscript" }]),
    );
    for (const s of ["#strike[a]", "#super[b]", "#sub[c]"]) expect(out).toContain(s);
  });
  it("passes inline code through a raw string so markup characters stay literal", () => {
    const out = src(text('#let x = "y" *z*', [{ type: "code" }]));
    expect(out).toContain('#raw("#let x = \\"y\\" *z*")');
  });
});

describe("code blocks", () => {
  it("emits a raw block from an escaped string and keeps newlines", () => {
    const out = buildTypst(
      book,
      ch({ type: "codeBlock", content: [text('#let x = "y"\n  *z* \\')] }),
    );
    expect(out).toContain('#raw(block: true, "#let x = \\"y\\"\\n  *z* \\\\")');
  });
  it("rejects non-text children", () => {
    expect(() =>
      buildTypst(book, ch({ type: "codeBlock", content: [{ type: "footnote" } as never] })),
    ).toThrow(/Unsupported/);
  });
});

describe("escaping inside documents", () => {
  it("never leaks hostile text out of table cells", () => {
    const cell = (type: "tableCell" | "tableHeader", h: string): DocNode => ({
      type,
      content: [para(text(h))],
    });
    const out = buildTypst(
      book,
      ch({
        type: "table",
        content: [
          { type: "tableRow", content: HOSTILE.slice(0, 2).map((h) => cell("tableHeader", h)) },
          { type: "tableRow", content: HOSTILE.slice(0, 2).map((h) => cell("tableCell", h)) },
        ],
      }),
    );
    const body = out.slice(out.indexOf("#table("));
    expect(body).not.toMatch(/(^|[^\\])#let x/);
    expect(body).not.toMatch(/(^|[^\\])\/\//m);
    expect(body).not.toContain("\n= not");
    expect(body).toContain("\\#let x = 1");
  });
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
    const out = buildTypst({ title: 'He said "#hi"\\', author: "A $ B", language: "en" }, [
      {
        id: "c",
        title: 'Ch "1" \\ #x',
        doc: {
          type: "doc",
          content: [
            para(text("l", [{ type: "link", attrs: { href: 'https://x.test/"quote' } }])),
            { type: "image", attrs: { src: "a.png", alt: 'alt "x"', title: "Cap #1 *b*" } },
          ],
        },
      },
    ]);
    expect(out).toContain('#let book-title = "He said \\"#hi\\"\\\\"');
    expect(out).toContain('author: "A $ B"');
    expect(out).toContain('#chapter-start("Ch \\"1\\" \\\\ #x", 1,');
    expect(out).toContain('#link("https://x.test/\\"quote")[l]');
    expect(out).toContain('"alt \\"x\\""');
    expect(out).toContain("caption: [Cap \\#1 \\*b\\*]");
  });
  it("gives a decorative image no alt text whatever alt holds", () => {
    const out = buildTypst(
      book,
      ch({ type: "image", attrs: { src: "a.png", alt: "ignored", decorative: true } } as DocNode),
    );
    expect(out).toMatch(/#figure\(fit-image\([^)]*, none,/);
    expect(out).not.toContain("ignored");
  });
  it("protects text right after an inline call", () => {
    const out = buildTypst(book, ch(para(text("a", [{ type: "bold" }]), text(".b (c)"))));
    expect(out).toContain("#strong[a]\\.b (c)");
  });
});

describe("unsupported input", () => {
  it("throws on unknown node types instead of dropping them", () => {
    expect(() => buildTypst(book, ch({ type: "figcaption" }))).toThrow(PdfExportError);
    expect(() => buildTypst(book, ch({ type: "figcaption" }))).toThrow(
      /Unsupported node type in chapter: figcaption/,
    );
    expect(() => buildTypst(book, ch(para({ type: "bogusInline" } as unknown as DocNode)))).toThrow(
      /bogusInline/,
    );
  });
  it("renders hard breaks as Typst line breaks and escapes block markers after them", () => {
    const br = { type: "hardBreak" } as DocNode;
    const out = buildTypst(book, ch(para(text("one"), br, text("- two"), br, text("1. three"))));
    expect(out).toContain("one\\\n\\- two\\\n1\\. three");
    const inNote = buildTypst(
      book,
      ch(para(text("a"), { type: "footnote", content: [para(text("n"), br, text("m"))] })),
    );
    expect(inNote).toContain("#footnote[n\\\nm]");
  });
  it("throws on heading levels outside 1-3 and non-numeric levels", () => {
    for (const level of [0, 4, 6, "x", 1.5])
      expect(() =>
        buildTypst(book, ch({ type: "heading", attrs: { level }, content: [text("H")] })),
      ).toThrow(/Heading level .* is not allowed/);
  });
  it("throws on malformed tables", () => {
    const cell = (t: string): DocNode => ({ type: "tableCell", content: [para(text(t))] });
    const row = (...c: DocNode[]): DocNode => ({ type: "tableRow", content: c });
    const table = (...r: DocNode[]): DocNode => ({ type: "table", content: r });
    expect(() => buildTypst(book, ch({ type: "table" }))).toThrow(/without rows/);
    expect(() => buildTypst(book, ch(table(row(cell("a"), cell("b")), row(cell("c")))))).toThrow(
      /same, non-zero/,
    );
    expect(() => buildTypst(book, ch(table(row())))).toThrow(PdfExportError);
    expect(() => buildTypst(book, ch(table(para(text("x")))))).toThrow(/paragraph/);
    expect(() =>
      buildTypst(
        book,
        ch(table(row({ type: "tableCell", content: [{ type: "bulletList", content: [] }] }))),
      ),
    ).toThrow(/table cell/);
  });
  it("throws on unknown marks", () => {
    expect(() => buildTypst(book, ch(para(text("x", [{ type: "bogus" } as never]))))).toThrow(
      /bogus/,
    );
  });
  it("throws on nested footnotes and unsupported image types", () => {
    const fn = (...c: DocNode[]): DocNode => ({ type: "footnote", content: c });
    expect(() => buildTypst(book, ch(para(fn(fn(text("x"))))))).toThrow(/nested/);
    expect(() => buildTypst(book, ch({ type: "image", attrs: { src: "a.bmp" } }))).toThrow(
      /Unsupported image type/,
    );
    expect(() => buildTypst(book, ch({ type: "image", attrs: { src: "" } }))).toThrow(
      /without a source/,
    );
  });
  it("rejects bad geometry and unknown templates", () => {
    expect(() => buildTypst(book, ch(), { margins: { inside: 5 } })).toThrow(/margin/);
    expect(() => buildTypst(book, ch(), { margins: { inside: 3, outside: 3 } })).toThrow(
      /too little room/,
    );
    expect(() => buildTypst(book, ch(), { trimSize: "9x9" as never })).toThrow(/trim size/);
    expect(() => buildTypst(book, ch(), { template: "nope" })).toThrow(/Unknown template/);
    expect(() => buildTypst(book, ch(), { fontSizePt: 2 })).toThrow(/font size/);
  });
});

describe("images", () => {
  const img: DocNode = {
    type: "image",
    attrs: { src: "pics/cover.JPEG", alt: "Cover", title: "The cover" },
  };
  it("maps sources to deterministic relative asset paths", () => {
    const doc = buildTypstDocument(book, ch(img, img, { type: "image", attrs: { src: "b.svg" } }));
    expect([...doc.images]).toEqual([
      ["pics/cover.JPEG", "assets/img-1.jpg"],
      ["b.svg", "assets/img-2.svg"],
    ]);
    expect(doc.source).toContain('fit-image("assets/img-1.jpg", "Cover"');
    expect(doc.source).toContain("caption: [The cover]");
  });
  it("never uses the original src as a file path", () => {
    const doc = buildTypstDocument(
      book,
      ch({ type: "image", attrs: { src: "../../etc/passwd.png" } }),
    );
    expect(doc.source).not.toContain("etc/passwd");
  });
  it("checks supplied assets", () => {
    expect(() => buildTypst(book, ch(img), { assets: {} })).toThrow(MissingAssetError);
    expect(() =>
      buildTypst(book, ch(img), { assets: { "pics/cover.JPEG": new Uint8Array([1]) } }),
    ).not.toThrow();
  });
});

describe("page setup options", () => {
  const page = (o: Parameters<typeof buildTypst>[2]): string =>
    buildTypst(book, ch(), o).split("#set text")[0]!;
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
    expect(buildTypst(book, ch(), { template: "modern", chapterStart: "recto" })).toContain(
      'to: "odd"',
    );
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
    const run = (): unknown =>
      resolveFonts({ fonts: { body: "Nonexistent Sans" } }, ["Libertinus Serif"]);
    expect(run).toThrow(FontNotAvailableError);
    expect(run).toThrow(/"Nonexistent Sans" \(body\)/);
  });
  it("refuses a missing heading font", () => {
    expect(() => resolveFonts({ fonts: { heading: "Fancy" } }, ["Libertinus Serif"])).toThrow(
      /"Fancy" \(heading\)/,
    );
  });
  it("names all candidates when none of a template's fonts exist", () => {
    expect(() => resolveFonts({ template: "modern" }, ["Libertinus Serif"])).toThrow(
      /Inter.*Helvetica Neue.*Helvetica.*Arial/,
    );
  });
});

describe("text alignment", () => {
  const withAlign = (type: "paragraph" | "heading", textAlign: unknown, t: string): DocNode => ({
    type,
    attrs:
      type === "heading"
        ? { level: 2, textAlign: textAlign as string }
        : { textAlign: textAlign as string },
    content: [text(t)],
  });
  const scope = (align: string, body: string): string =>
    `#[#set align(${align})\n#set par(first-line-indent: 0pt, justify: false)\n${body}]`;

  it("sets an aligned paragraph in a scope with no indent and no justification, and leaves the others alone", () => {
    const src = buildTypst(
      book,
      ch(
        withAlign("paragraph", "center", "Middle"),
        withAlign("paragraph", "end", "Right"),
        withAlign("paragraph", "start", "Left"),
        para(text("Plain")),
        { type: "paragraph", attrs: { textAlign: null }, content: [text("Default")] },
      ),
    );
    expect(src).toContain(scope("center", "Middle"));
    expect(src).toContain(scope("end", "Right"));
    expect(src).toContain(scope("start", "Left"));
    expect(src).toContain("\n\nPlain\n\n");
    expect(src).toContain("\n\nDefault");
  });
  it("aligns headings, quotes, list items and table cells the same way", () => {
    const src = buildTypst(
      book,
      ch(withAlign("heading", "center", "Title"), {
        type: "blockquote",
        content: [withAlign("paragraph", "end", "Quoted")],
      }),
    );
    // A heading says its alignment through its supplement: the template's heading rule sets the alignment inside its own block.
    expect(src).toContain("#heading(level: 2, supplement: [ha-center])[Title]");
    expect(src).toContain("#let heading-align(it, template)");
    expect(src).toContain("set align(heading-align(it, center))");
    expect(src).toContain(`#quote(block: true)[\n${scope("end", "Quoted")}\n]`);
  });
  it("refuses an alignment that is not start, center or end", () => {
    expect(() => buildTypst(book, ch(withAlign("paragraph", "justify", "x")))).toThrow(
      /Text alignment "justify" is not allowed/,
    );
    expect(() => buildTypst(book, ch(withAlign("heading", 3, "x")))).toThrow(PdfExportError);
  });
  it("gives an aligned first paragraph no drop cap", () => {
    const doc = buildTypstDocument(
      book,
      ch(withAlign("paragraph", "center", "Once upon a time."), para(text("Second."))),
      { template: "novel" },
    );
    expect(doc.usesDropCap).toBe(false);
    expect(doc.source).toContain(scope("center", "Once upon a time."));
  });
});

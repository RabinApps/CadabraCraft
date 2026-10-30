import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { DocxExportError, buildDocx, type DocxChapter } from "../index";
import { imageSize } from "../image";
import { inline, para } from "../paragraphs";
import { settleTables } from "../tables";
import type { Ctx } from "../types";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const chapter = (title: string, ...content: DocNode[]): DocxChapter => ({
  title,
  doc: doc(...content),
});
const book = { title: "The Long Road", author: "Ada Lovelace" };
const documentXml = (bytes: Uint8Array): string =>
  strFromU8(unzipSync(bytes)["word/document.xml"]!);
const build = (...chapters: DocxChapter[]): string => documentXml(buildDocx(book, chapters));
const item = (...content: DocNode[]): DocNode => ({ type: "listItem", content });
const row = (...cells: DocNode[]): DocNode => ({ type: "tableRow", content: cells });
const cell = (...content: DocNode[]): DocNode => ({ type: "tableCell", content });
const table = (...rows: DocNode[]): DocNode => ({ type: "table", content: rows });
const image = (attrs?: Record<string, string | null>): DocNode =>
  (attrs ? { type: "image", attrs } : { type: "image" }) as DocNode;

const bytes = (length: number, ...at: [number, number[]][]): Uint8Array => {
  const b = new Uint8Array(length);
  for (const [i, v] of at) b.set(v, i);
  return b;
};
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const PNG_HEAD: [number, number[]][] = [
  [0, [0x89, ...ascii("PNG")]],
  [12, ascii("IHDR")],
];

describe("blocks", () => {
  it("drops empty paragraphs, headings and captions", () => {
    const d = build(
      chapter(
        "A",
        p(),
        { type: "heading", attrs: { level: 2 } },
        { type: "figcaption" },
        p(t("kept")),
      ),
    );
    expect(d).not.toContain("Heading2");
    expect(d).not.toContain("Caption");
    expect(d).toContain("kept");
  });
  it("defaults a heading without a level to 1 and writes figcaptions", () => {
    const d = build(
      chapter(
        "A",
        { type: "heading", content: [t("Head")] },
        { type: "figcaption", content: [t("Cap")] },
      ),
    );
    expect(d).toContain('w:val="Heading1"');
    expect(d).toContain('w:val="Caption"');
  });
  it("refuses a heading level outside 1-3, also when the level is missing text", () => {
    expect(() =>
      build(chapter("A", { type: "heading", attrs: { level: 4 }, content: [t("x")] })),
    ).toThrow(/level 4/);
  });
  it("indents code blocks inside block quotes and refuses non-text children", () => {
    const d = build(
      chapter("A", {
        type: "blockquote",
        content: [{ type: "codeBlock", content: [t("a\nb")] }],
      }),
    );
    expect(d).toContain('<w:pStyle w:val="CodeBlock"/><w:ind w:left="720" w:firstLine="0"/>');
    expect(() =>
      build(chapter("A", { type: "codeBlock", content: [{ type: "hardBreak" } as never] })),
    ).toThrow(/cannot be written in a code block/);
  });
  it("writes a table that opens a new page after a page break", () => {
    const d = build(chapter("A", p(t("x"))), chapter("", table(row(cell(p(t("c")))))));
    expect(d).toContain("<w:pageBreakBefore/>");
    expect(d).toContain("<w:tbl>");
  });
  it("writes an image without alt or title and refuses one without a source", () => {
    const assets = new Map([
      ["assets/a.png", bytes(33, ...PNG_HEAD, [16, [0, 0, 0, 2]], [20, [0, 0, 0, 2]])],
    ]);
    const d = documentXml(
      buildDocx(book, [chapter("A", image({ src: "assets/a.png" }))], { assets }),
    );
    expect(d).toContain('descr=""');
    expect(d).not.toContain('w:val="Caption"');
    expect(() => build(chapter("A", image()))).toThrow(/not a project image/);
  });
  it("uses the title as the description and adds a caption", () => {
    const assets = new Map([
      ["assets/a.png", bytes(33, ...PNG_HEAD, [16, [0, 0, 0, 2]], [20, [0, 0, 0, 2]])],
    ]);
    const d = documentXml(
      buildDocx(book, [chapter("A", image({ src: "assets/a.png", alt: "", title: "Fig" }))], {
        assets,
      }),
    );
    expect(d).toContain('descr="Fig"');
    expect(d).toContain('w:val="Caption"');
  });
  it("refuses an image type Word export does not know", () => {
    expect(() =>
      buildDocx(book, [chapter("A", image({ src: "assets/a.bmp" }))], {
        assets: new Map([["assets/a.bmp", new Uint8Array(4)]]),
      }),
    ).toThrow(/unsupported type/);
  });
});

describe("book and page handling", () => {
  it("writes an empty title and author as empty paragraphs", () => {
    const d = documentXml(buildDocx({ title: "", author: "" }, [chapter("A", p(t("x")))]));
    expect(d).not.toContain("by ");
    expect(d).toContain('<w:pStyle w:val="Title"/>');
  });
  it("counts front and back pages when there are no chapters, with the singular word", () => {
    const d = documentXml(
      buildDocx(book, [{ ...chapter("Dedication", p(t("one"))), section: "front" }]),
    );
    expect(d).toContain("About 1 word");
  });
  it("labels an untitled page by its id, then a placeholder, in errors", () => {
    const bad = { type: "mystery" } as never;
    const err = (c: DocxChapter): DocxExportError => {
      try {
        buildDocx(book, [c]);
      } catch (e) {
        return e as DocxExportError;
      }
      throw new Error("did not throw");
    };
    expect(err({ id: "ch-9", title: "  ", doc: doc(bad) }).chapter).toBe("ch-9");
    expect(err({ title: "", doc: doc(bad) }).chapter).toBe("(untitled page)");
  });
  it.each([
    ["not an object", undefined],
    ["a wrong type", { type: "paragraph", content: [] }],
    ["no content", { type: "doc" }],
  ])("refuses a chapter document that is %s", (_name, bad) => {
    expect(() => buildDocx(book, [{ title: "A", doc: bad as never }])).toThrow(
      /must be an object with type "doc"/,
    );
  });
  it("writes empty pages after the first on their own page and skips title-page pages", () => {
    const d = documentXml(
      buildDocx(book, [
        chapter("A", p(t("x"))),
        chapter(""),
        { ...chapter("T", p(t("ignored"))), kind: "title-page", section: "front" },
      ]),
    );
    expect(d).not.toContain("ignored");
    expect(d.match(/<w:pageBreakBefore\/>/g)).toHaveLength(1);
  });
  it("leaves out an empty leading heading and chapters titled only by whitespace", () => {
    const d = build(
      chapter("A", { type: "heading", attrs: { level: 1 } }, p(t("body"))),
      chapter("   ", p(t("more"))),
    );
    expect(d).not.toContain('w:val="Heading1"');
  });
  it("does not add a title heading to front matter", () => {
    const d = documentXml(
      buildDocx(book, [{ ...chapter("Dedication", p(t("for you"))), section: "front" }]),
    );
    expect(d).not.toContain("Dedication");
  });
});

describe("lists", () => {
  it("refuses lists nested more than 9 levels deep", () => {
    let node: DocNode = { type: "bulletList", content: [item(p(t("deep")))] };
    for (let i = 0; i < 9; i++) node = { type: "bulletList", content: [item(node)] };
    expect(() => build(chapter("A", node))).toThrow(/more than 9 levels/);
  });
  it("refuses a non-item child of a list", () => {
    expect(() => build(chapter("A", { type: "bulletList", content: [p(t("x"))] }))).toThrow(
      /cannot be written in a list/,
    );
  });
  it("falls back to start 1 for a bad start attribute", () => {
    const d = buildDocx(book, [
      chapter("A", {
        type: "orderedList",
        attrs: { start: -2 },
        content: [item(p(t("x")))],
      }),
    ]);
    expect(strFromU8(unzipSync(d)["word/numbering.xml"]!)).toContain(
      '<w:startOverride w:val="1"/>',
    );
  });
  it("handles continuation paragraphs, empty items and leading non-paragraphs", () => {
    const d = build(
      chapter("A", {
        type: "bulletList",
        content: [
          item(p(t("first")), p(t("second")), p(), p(t("")), { type: "sceneBreak" }),
          item(),
          item({ type: "sceneBreak" }),
        ],
      }),
    );
    expect(d).toContain("second");
    expect(d.match(/<w:numPr>/g)).toHaveLength(3);
  });
});

describe("tables", () => {
  it("refuses malformed tables", () => {
    expect(() => build(chapter("A", table()))).toThrow(/no rows/);
    expect(() => build(chapter("A", table(row())))).toThrow(/no cells/);
    expect(() => build(chapter("A", table(p(t("x")))))).toThrow(/cannot be written in a table/);
    expect(() => build(chapter("A", table(row(cell(p())), row(cell(p()), cell(p())))))).toThrow(
      /same number of cells/,
    );
    expect(() => build(chapter("A", table(row(p(t("x"))))))).toThrow(
      /cannot be written in a table row/,
    );
    expect(() => build(chapter("A", table(row(cell({ type: "sceneBreak" })))))).toThrow(
      /cannot be written in a table cell/,
    );
  });
  it("marks header rows, bolds header text and fills empty cells", () => {
    const d = build(
      chapter(
        "A",
        table(row({ type: "tableHeader", content: [p(t("H"))] }), row({ type: "tableCell" })),
      ),
    );
    expect(d).toContain("<w:tblHeader/>");
    expect(d).toContain("<w:b/>");
    expect(d.match(/<w:cantSplit\/>/g)).toHaveLength(2);
  });
  it("sets the first-row flag of tblLook only when the first row is a header row", () => {
    const head = { type: "tableHeader", content: [p(t("H"))] } as DocNode;
    const withHeader = build(chapter("A", table(row(head), row({ type: "tableCell" }))));
    expect(withHeader).toContain('<w:tblLook w:val="0420" w:firstRow="1"');
    const without = build(
      chapter("A", table(row({ type: "tableCell" }), row({ type: "tableCell" }))),
    );
    expect(without).toContain('<w:tblLook w:val="0400" w:firstRow="0"');
    expect(without).not.toContain("<w:tblHeader/>");
  });
});

describe("paragraph properties", () => {
  const ctx = { s: { pendingBreak: false } } as unknown as Ctx;
  it.each([
    [{ right: 5 }, '<w:ind w:right="5"/>'],
    [{ hanging: 5 }, '<w:ind w:hanging="5"/>'],
    [{ firstLine: 5 }, '<w:ind w:firstLine="5"/>'],
    [
      { left: 1, right: 2, hanging: 3, firstLine: 4 },
      '<w:ind w:left="1" w:right="2" w:hanging="3" w:firstLine="4"/>',
    ],
    [{ numId: 4 }, '<w:ilvl w:val="0"/><w:numId w:val="4"/>'],
    [{ jc: "center" as const }, '<w:jc w:val="center"/>'],
    [{ spaceBefore: 9 }, '<w:spacing w:before="9"/>'],
  ])("writes %j", (opts, xml) => {
    expect(para("", opts, ctx)).toContain(xml);
  });
  it("writes a bare paragraph with no properties", () => {
    expect(para("x", {}, ctx)).toBe("<w:p>x</w:p>");
  });
});

describe("inline nodes", () => {
  it("writes hard breaks, tabs and line feeds, and skips empty text", () => {
    const d = build(chapter("A", p(t("a\tb\nc"), t(""), { type: "hardBreak" } as never)));
    expect(d).toContain("<w:tab/>");
    expect(d.match(/<w:br\/>/g)).toHaveLength(2);
  });
  it("refuses a link address with a bad character", () => {
    expect(() =>
      build(
        chapter(
          "A",
          p({ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "a\u0001" } }] }),
        ),
      ),
    ).toThrow(/link address/);
  });
  it("refuses bad characters in a chapter title, caption and image description", () => {
    expect(() => build(chapter("A\u0001", p(t("x"))))).toThrow(DocxExportError);
    const assets = new Map([
      ["assets/a.png", bytes(33, ...PNG_HEAD, [16, [0, 0, 0, 2]], [20, [0, 0, 0, 2]])],
    ]);
    expect(() =>
      buildDocx(book, [chapter("A", image({ src: "assets/a.png", alt: "x\u0001" }))], { assets }),
    ).toThrow(DocxExportError);
  });
});

describe("imageSize", () => {
  const size = (b: Uint8Array, type: string) => imageSize(b, type, "assets/x", "C");
  const jpegHead = (sof: number, extra: number[] = []): Uint8Array =>
    Uint8Array.from([
      0xff,
      0xd8,
      ...extra,
      0xff,
      sof,
      0,
      17,
      8,
      0,
      20,
      0,
      30,
      3,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);

  it("reads PNG, GIF, JPEG and the three WebP forms", () => {
    expect(
      size(bytes(33, ...PNG_HEAD, [16, [0, 0, 1, 0]], [20, [0, 0, 0, 7]]), "image/png"),
    ).toEqual({ width: 256, height: 7 });
    expect(size(bytes(12, [0, ascii("GIF89a")], [6, [5, 0, 6, 0]]), "image/gif")).toEqual({
      width: 5,
      height: 6,
    });
    expect(size(jpegHead(0xc0), "image/jpeg")).toEqual({ width: 30, height: 20 });
    const webp = (kind: string, ...at: [number, number[]][]) =>
      bytes(40, [0, ascii("RIFF")], [8, ascii("WEBP")], [12, ascii(kind)], ...at);
    expect(size(webp("VP8 ", [26, [9, 0, 8, 0]]), "image/webp")).toEqual({ width: 9, height: 8 });
    expect(size(webp("VP8L", [21, [0x03, 0, 0, 0]]), "image/webp")).toEqual({
      width: 4,
      height: 1,
    });
    expect(size(webp("VP8X", [24, [9, 0, 0, 4, 0, 0]]), "image/webp")).toEqual({
      width: 10,
      height: 5,
    });
  });
  it("skips stray bytes, fill bytes, standalone markers and other segments in a JPEG", () => {
    const b = Uint8Array.from([
      0xff, 0xd8, 0x00, 0xff, 0xff, 0xff, 0x01, 0xff, 0xd0, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc4, 0,
      4, 0, 0, 0xff, 0xc2, 0, 17, 8, 0, 20, 0, 30, 3, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(size(b, "image/jpeg")).toEqual({ width: 30, height: 20 });
  });
  it.each([
    ["a short PNG", bytes(10), "image/png"],
    [
      "a PNG with a bad signature byte",
      bytes(33, [0, [0x88, ...ascii("PNG")]], [12, ascii("IHDR")]),
      "image/png",
    ],
    [
      "a PNG with a bad name",
      bytes(33, [0, [0x89, ...ascii("PNX")]], [12, ascii("IHDR")]),
      "image/png",
    ],
    [
      "a PNG without IHDR",
      bytes(33, [0, [0x89, ...ascii("PNG")]], [12, ascii("IDAT")]),
      "image/png",
    ],
    ["a PNG with zero size", bytes(33, ...PNG_HEAD), "image/png"],
    ["a short JPEG", bytes(3), "image/jpeg"],
    ["a JPEG with a bad first byte", bytes(20, [0, [0xfe, 0xd8]]), "image/jpeg"],
    ["a JPEG with a bad second byte", bytes(20, [0, [0xff, 0xd9]]), "image/jpeg"],
    ["a JPEG without a frame", bytes(20, [0, [0xff, 0xd8]]), "image/jpeg"],
    ["a short GIF", bytes(8), "image/gif"],
    ["a non-GIF", bytes(12), "image/gif"],
    ["a short WebP", bytes(20), "image/webp"],
    ["a WebP without RIFF", bytes(40, [8, ascii("WEBP")]), "image/webp"],
    ["a WebP without the WEBP tag", bytes(40, [0, ascii("RIFF")]), "image/webp"],
    [
      "a WebP of an unknown kind",
      bytes(40, [0, ascii("RIFF")], [8, ascii("WEBP")], [12, ascii("ABCD")]),
      "image/webp",
    ],
    ["an unknown media type", bytes(40), "image/avif"],
  ])("refuses %s", (_name, b, type) => {
    expect(() => size(b, type)).toThrow(DocxExportError);
  });
  it("names the file type and chapter in the error", () => {
    try {
      size(bytes(4), "image/gif");
      expect.unreachable();
    } catch (e) {
      expect((e as DocxExportError).message).toContain("GIF");
      expect((e as DocxExportError).chapter).toBe("C");
    }
  });
});

describe("shared helpers", () => {
  const ctx = { s: { pendingBreak: false } } as unknown as Ctx;
  it("treats missing inline content as empty", () => {
    expect(inline(undefined, ctx)).toBe("");
  });
  it("reuses one relationship for a link address used twice", () => {
    const link = { type: "link" as const, attrs: { href: "https://example.com" } };
    const run: DocNode = { type: "text", text: "x", marks: [link] };
    const d = build(chapter("A", p(run, run)));
    expect(d.match(/r:id="rId\d+" w:history/g)).toHaveLength(2);
    expect(new Set(d.match(/r:id="rId\d+" w:history/g)).size).toBe(1);
  });
  it("keeps a table marker's neighbour and only pads where tables would touch", () => {
    expect(settleTables(["<w:tbl>a</w:tbl>", "<!--after-table-->", "<w:p>x</w:p>"])).toEqual([
      "<w:tbl>a</w:tbl>",
      "<w:p>x</w:p>",
    ]);
  });
});

// Edge cases of the XHTML walker, the error type, the strings table and the package builder.
import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import {
  EpubExportError,
  buildEpub,
  chapterToXhtmlBody,
  collectImageSources,
  imageAltStats,
} from "../index";
import { coverLabel, landmarksHeading, startOfContentLabel } from "../strings";

const meta = {
  title: "T",
  author: "A",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};
const text = (t: string): DocNode => ({ type: "text", text: t });
const para = (t = "x"): DocNode => ({ type: "paragraph", content: [text(t)] });
const doc = (...content: unknown[]): ChapterDoc => ({ type: "doc", content: content as DocNode[] });
const body = (...content: unknown[]) => chapterToXhtmlBody(doc(...content));
const chapter = (id: string, title: string) => ({ id, title, doc: doc(para()) });
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};
const cell = (type: string, t = "c") => ({ type, content: [para(t)] });
const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });

describe("inline content", () => {
  it("renders underline, small caps and links (with and without a target)", () => {
    const mark = (type: string, attrs?: object) => ({
      type: "paragraph",
      content: [{ type: "text", text: "t", marks: [{ type, ...(attrs ? { attrs } : {}) }] }],
    });
    expect(body(mark("underline"))).toContain('<span class="underline">t</span>');
    expect(body(mark("smallCaps"))).toContain('<span class="small-caps">t</span>');
    expect(body(mark("link", { href: "https://e.org/?a=1&b=2" }))).toContain(
      '<a href="https://e.org/?a=1&amp;b=2">t</a>',
    );
    expect(body(mark("link"))).toContain('<a href="">t</a>');
  });

  it("renders a block node found inside a paragraph", () => {
    expect(body({ type: "paragraph", content: [text("a"), { type: "sceneBreak" }] })).toBe(
      '<p>a<hr class="scene-break"/></p>',
    );
  });

  it("renders containers and headings with no content or attributes", () => {
    expect(body({ type: "blockquote" })).toBe("<blockquote></blockquote>");
    expect(body({ type: "heading" })).toBe("<h1></h1>");
    expect(body({ type: "paragraph" })).toBe("<p></p>");
  });

  it("renders images with no attributes, only a source, or an empty title", () => {
    expect(body({ type: "image" })).toBe('<figure><img src="" alt=""/></figure>');
    expect(body({ type: "image", attrs: { src: "assets/a.png" } })).toBe(
      '<figure><img src="assets/a.png" alt=""/></figure>',
    );
  });

  it("rejects an unknown mark and says where", () => {
    const e = thrown(() =>
      body({
        type: "paragraph",
        content: [{ type: "text", text: "t", marks: [{ type: "glow" }] }],
      }),
    ) as EpubExportError;
    expect(e.code).toBe("unsupported-mark");
    expect(e.where).toEqual({ nodeType: "mark glow", path: "paragraph 1 > text 1" });
  });
});

describe("tables", () => {
  it("renders a header row, row headers and a body", () => {
    const html = body({
      type: "table",
      content: [
        row(cell("tableHeader", "H1"), cell("tableHeader", "H2")),
        row(cell("tableHeader", "R"), cell("tableCell", "v")),
      ],
    });
    expect(html).toBe(
      '<table><thead><tr><th scope="col"><p>H1</p></th><th scope="col"><p>H2</p></th></tr></thead>' +
        '<tbody><tr><th scope="row"><p>R</p></th><td><p>v</p></td></tr></tbody></table>',
    );
  });

  it("renders a table of only a header row without a body", () => {
    expect(body({ type: "table", content: [row(cell("tableHeader"))] })).toBe(
      '<table><thead><tr><th scope="col"><p>c</p></th></tr></thead></table>',
    );
  });

  it("renders an empty cell", () => {
    expect(body({ type: "table", content: [row({ type: "tableCell" })] })).toBe(
      "<table><tbody><tr><td></td></tr></tbody></table>",
    );
  });

  it("refuses tables without rows, or whose rows differ in width or are empty", () => {
    const malformed = (t: unknown) => (thrown(() => body(t)) as EpubExportError).code;
    expect(malformed({ type: "table" })).toBe("malformed-table");
    expect(malformed({ type: "table", content: [] })).toBe("malformed-table");
    expect(
      malformed({
        type: "table",
        content: [row(cell("tableCell")), row(cell("tableCell"), cell("tableCell"))],
      }),
    ).toBe("malformed-table");
    expect(malformed({ type: "table", content: [{ type: "tableRow" }] })).toBe("malformed-table");
  });

  it("refuses anything but rows, cells and paragraphs inside a table", () => {
    const unsupported = (t: unknown) => thrown(() => body(t)) as EpubExportError;
    expect(unsupported({ type: "table", content: [para()] }).where.nodeType).toBe("paragraph");
    expect(unsupported({ type: "table", content: [row(para())] }).where.nodeType).toBe("paragraph");
    expect(
      unsupported({
        type: "table",
        content: [row({ type: "tableCell", content: [{ type: "image" }] })],
      }).where.nodeType,
    ).toBe("image");
  });
});

describe("image helpers", () => {
  it("find images in nodes whose content is missing", () => {
    const d = doc(
      { type: "image" },
      { type: "paragraph", content: undefined },
      { type: "image", attrs: { src: "assets/a.png", alt: " " } },
    );
    expect(collectImageSources(d)).toEqual(["", "assets/a.png"]);
    expect(imageAltStats(d)).toEqual({ total: 2, missingAlt: 2 });
  });
  it("count a document with no content array as empty", () => {
    expect(collectImageSources({ type: "doc" } as never)).toEqual([]);
    expect(imageAltStats({ type: "doc" } as never)).toEqual({ total: 0, missingAlt: 0 });
  });
});

describe("EpubExportError", () => {
  it("keeps the page it already names", () => {
    const e = new EpubExportError("unsupported-node", "bad", { chapter: { id: "a", title: "A" } });
    expect(e.inChapter({ id: "b", title: "B" })).toBe(e);
  });
  it("names a page without a title by its id", () => {
    const e = new EpubExportError("unsupported-node", "bad").inChapter({ id: "ch-3", title: "  " });
    expect(e.message).toBe('In "ch-3": bad');
  });
});

describe("strings", () => {
  it("refuse a language they have no text for", () => {
    for (const fn of [landmarksHeading, startOfContentLabel, coverLabel])
      expect(() => fn("xx")).toThrow(/no ".+" translation for language "xx"/);
  });
});

describe("buildEpub edge cases", () => {
  const files = (chapters: Parameters<typeof buildEpub>[1]) => unzipSync(buildEpub(meta, chapters));

  it("builds a book with no pages: the landmarks have no start of content", () => {
    const nav = strFromU8(files([])["OEBPS/nav.xhtml"]!);
    expect(nav).not.toContain('epub:type="bodymatter"');
    expect(nav).toContain('epub:type="toc"');
  });

  it("gives a matter page with no kind a generic class", () => {
    const f = files([{ id: "fm-1", title: "Note", doc: doc(para()), section: "front" }]);
    expect(strFromU8(f["OEBPS/fm-1.xhtml"]!)).toContain('epub:type="frontmatter" class="custom"');
  });

  it("passes on an error that is not an EpubExportError", () => {
    const e = thrown(() =>
      buildEpub(meta, [{ id: "ch-1", title: "One", doc: { type: "doc" } as never }]),
    );
    expect(e).toBeInstanceOf(TypeError);
  });
});

describe("hard breaks, headings, footnotes and text validity", () => {
  it("writes a hard break as <br/>, in paragraphs, footnotes and table cells", () => {
    const br = { type: "hardBreak" };
    expect(body({ type: "paragraph", content: [text("a"), br, text("b")] })).toBe("<p>a<br/>b</p>");
    const withNote = body({
      type: "paragraph",
      content: [text("a"), { type: "footnote", content: [text("n"), br, text("m")] }],
    });
    expect(withNote).toContain("<p>n<br/>m <a");
    const cell = { type: "tableCell", content: [{ type: "paragraph", content: [text("a"), br] }] };
    expect(body({ type: "table", content: [{ type: "tableRow", content: [cell] }] })).toContain(
      "<td><p>a<br/></p></td>",
    );
  });

  it("refuses a hard break in a code block", () => {
    expect(() => body({ type: "codeBlock", content: [{ type: "hardBreak" }] })).toThrow(
      /code block/,
    );
  });

  it("accepts heading levels 1-3 and a missing level, and throws on anything else", () => {
    const h = (level: unknown) => ({
      type: "heading",
      ...(level === undefined ? {} : { attrs: { level } }),
      content: [text("H")],
    });
    expect(body(h(undefined))).toBe("<h1>H</h1>");
    expect(body(h(3))).toBe("<h3>H</h3>");
    for (const level of [0, 4, 6, "x", 1.5]) {
      const e = thrown(() => body(h(level))) as EpubExportError;
      expect(e).toBeInstanceOf(EpubExportError);
      expect(e.code).toBe("invalid-heading");
      expect(e.where.nodeType).toBe("heading");
    }
  });

  it("throws on nested footnotes and recovers for the next footnote", () => {
    const fn = (...content: unknown[]) => ({ type: "footnote", content });
    const e = thrown(() =>
      body({ type: "paragraph", content: [fn(fn(text("x")))] }),
    ) as EpubExportError;
    expect(e.code).toBe("nested-footnote");
    // siblings are fine
    expect(body({ type: "paragraph", content: [fn(text("a")), fn(text("b"))] })).toContain(
      'id="fn2"',
    );
  });

  it("rejects characters XML cannot hold, in chapters and in metadata", () => {
    for (const bad of [
      "a\u0000b",
      "a\u0008b",
      "a\u000Bb",
      "a\u001Fb",
      "a￾b",
      "a\uD800b",
      "a\uDC00b",
    ]) {
      const e = thrown(() => body({ type: "paragraph", content: [text(bad)] })) as EpubExportError;
      expect(e.code).toBe("invalid-text");
      expect(e.message).toMatch(/U\+[0-9A-F]{4}/);
    }
    expect(
      thrown(() => buildEpub({ ...meta, title: "T\u0001" }, [chapter("c1", "C")])),
    ).toBeInstanceOf(EpubExportError);
    // tab, newline, CR, astral characters (valid surrogate pairs) and ordinary text are fine
    expect(body({ type: "paragraph", content: [text("a\tb\n\r\u{1F600} é")] })).toContain(
      "\u{1F600}",
    );
  });
});

describe("page ids", () => {
  it.each(["", "1a", "a b", "../x", "a/b", "a.b", "é", "x".repeat(65)])("refuses id %j", (id) => {
    const e = thrown(() => buildEpub(meta, [chapter(id, "C")])) as EpubExportError;
    expect(e.code).toBe("invalid-id");
    expect(e.where.chapter?.id).toBe(id);
  });
  it.each(["nav", "css", "epub-cover", "epub-cover-image", "img-asset-1"])(
    "refuses the reserved id %j",
    (id) => {
      expect((thrown(() => buildEpub(meta, [chapter(id, "C")])) as EpubExportError).code).toBe(
        "invalid-id",
      );
    },
  );
  it("refuses a duplicate id and accepts the usual ones", () => {
    expect(
      (
        thrown(() =>
          buildEpub(meta, [chapter("ch-1", "A"), chapter("ch-1", "B")]),
        ) as EpubExportError
      ).code,
    ).toBe("invalid-id");
    expect(() => buildEpub(meta, [chapter("ch-1", "A"), chapter("title_page", "B")])).not.toThrow();
  });
});

describe("SVG images", () => {
  const svg = (inner: string, attrs = "") =>
    new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`);
  const withSvg = (bytes: Uint8Array) =>
    buildEpub(
      meta,
      [{ id: "c1", title: "C", doc: doc({ type: "image", attrs: { src: "assets/a.svg" } }) }],
      {
        assets: new Map([["assets/a.svg", bytes]]),
      },
    );
  it("accepts a plain SVG, internal references and embedded raster images", () => {
    expect(() => withSvg(svg('<rect width="1" height="1" fill="url(#g)"/>'))).not.toThrow();
    expect(() => withSvg(svg('<use href="#a"/><use xlink:href="#a"/>'))).not.toThrow();
    expect(() => withSvg(svg('<image href="data:image/png;base64,AAAA"/>'))).not.toThrow();
  });
  it.each([
    ["a script", "<script>alert(1)</script>"],
    ["an event handler", '<rect onload="x()"/>'],
    ["foreignObject", "<foreignObject><p/></foreignObject>"],
    ["an external image", '<image href="https://x.test/a.png"/>'],
    ["an external xlink image", '<image xlink:href="http://x.test/a.png"/>'],
    ["a link", '<a href="https://x.test"><rect/></a>'],
    ["a javascript: link", '<a href="javascript:alert(1)"><rect/></a>'],
    ["an external url()", '<rect style="fill:url(http://x.test/a)"/>'],
    ["an @import", "<style>@import 'x.css';</style>"],
    ["a doctype entity", "<!DOCTYPE svg [<!ENTITY x 'y'>]>"],
    ["a data: SVG image", '<image href="data:image/svg+xml;base64,AAAA"/>'],
  ])("refuses an SVG with %s", (_name, inner) => {
    const e = thrown(() => withSvg(svg(inner))) as EpubExportError;
    expect(e.code).toBe("unsupported-image");
    expect(e.where.chapter?.id).toBe("c1");
    expect(e.message).toMatch(/assets\/a\.svg/);
  });
});

describe("a typed tab (the editor's Tab key)", () => {
  it("becomes an em space in text, which XHTML would otherwise collapse to nothing", () => {
    expect(body({ type: "paragraph", content: [text("\tIndented")] })).toContain(" Indented");
  });
  it("is kept in code, where the stylesheet preserves white space", () => {
    expect(
      body({
        type: "paragraph",
        content: [{ type: "text", text: "a\tb", marks: [{ type: "code" }] }],
      }),
    ).toContain("a\tb");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildEpub, chapterToXhtmlBody } from "../index";

const doc: ChapterDoc = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/manuscripts/sample-chapter.json", import.meta.url),
    "utf8",
  ),
);
const meta = {
  title: "T & Co",
  author: "A",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};

describe("chapterToXhtmlBody", () => {
  it("escapes text and renders marks, footnotes, scene breaks", () => {
    const html = chapterToXhtmlBody(doc);
    expect(html).toContain("cold day &amp; the clocks");
    expect(html).toContain("A quoted &lt;line&gt;.");
    expect(html).toContain("<strong>bright</strong>");
    expect(html).toContain('epub:type="noteref"');
    expect(html).toContain('<hr class="scene-break"/>');
    expect(html).toContain("a=1&amp;b=2");
  });
  it("renders strike, code, superscript and subscript", () => {
    const html = chapterToXhtmlBody(doc);
    for (const s of ["<s>struck</s>", "<code>a&lt;b</code>", "H<sub>2</sub>O", "x<sup>2</sup>"])
      expect(html).toContain(s);
  });
  it("renders code blocks as escaped pre/code with newlines kept", () => {
    const block = {
      type: "codeBlock",
      attrs: { language: 'js"x' },
      content: [{ type: "text", text: "if (a < b) {\n  go();\n}" }],
    };
    const html = chapterToXhtmlBody({ type: "doc", content: [block as never] });
    expect(html).toBe(
      '<pre><code class="language-js&quot;x">if (a &lt; b) {\n  go();\n}</code></pre>',
    );
    expect(chapterToXhtmlBody({ type: "doc", content: [{ type: "codeBlock" }] })).toBe(
      "<pre><code></code></pre>",
    );
    expect(() =>
      chapterToXhtmlBody({
        type: "doc",
        content: [{ type: "codeBlock", content: [{ type: "footnote" } as never] }],
      }),
    ).toThrow(/Unsupported/);
  });
  it("renders tables with a thead, th scopes, escaped cells and cell footnotes", () => {
    const html = chapterToXhtmlBody(doc);
    expect(html).toContain(
      '<table><thead><tr><th scope="col"><p>Item</p></th><th scope="col"><p>Cost &amp; note</p></th></tr></thead><tbody>',
    );
    expect(html).toContain("<td><p>a&lt;b</p></td>");
    expect(html).toMatch(/<td><p>Ten<a epub:type="noteref" role="doc-noteref" id="ref2"/);
  });
  it("rejects malformed tables", () => {
    const p = { type: "paragraph" } as never;
    const t = (...rows: unknown[]) =>
      ({ type: "doc", content: [{ type: "table", content: rows }] }) as never;
    const row = (...cells: unknown[]) => ({ type: "tableRow", content: cells });
    const cell = { type: "tableCell", content: [p] };
    expect(() => chapterToXhtmlBody(t())).toThrow(/without rows/);
    expect(() => chapterToXhtmlBody(t(row(cell, cell), row(cell)))).toThrow(/same, non-zero/);
    expect(() =>
      chapterToXhtmlBody(t(row({ type: "tableCell", content: [{ type: "bulletList" }] }))),
    ).toThrow(/table cell/);
  });
  it("rejects unknown marks with a clear error", () => {
    const bad = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bogus" }] }] },
      ],
    } as never;
    expect(() => chapterToXhtmlBody(bad)).toThrow(/Unsupported mark/);
  });
  it("rejects unknown nodes instead of dropping them", () => {
    expect(() =>
      chapterToXhtmlBody({
        type: "doc",
        content: [{ type: "footnote" } as never, { type: "bogus" } as never],
      }),
    ).toThrow(/Unsupported/);
  });
});

describe("buildEpub", () => {
  const bytes = buildEpub(meta, [{ id: "ch1", title: "Chapter One", doc }]);
  it("puts an uncompressed mimetype first", () => {
    expect(strFromU8(bytes.slice(30, 30 + 8))).toBe("mimetype");
    expect(strFromU8(bytes.slice(38, 58))).toBe("application/epub+zip");
  });
  it("contains the required parts", () => {
    const f = unzipSync(bytes);
    for (const p of [
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/ch1.xhtml",
      "OEBPS/style.css",
    ])
      expect(f[p]).toBeDefined();
    expect(strFromU8(f["OEBPS/content.opf"]!)).toContain("<dc:title>T &amp; Co</dc:title>");
  });
  it("is deterministic", () => {
    expect(Buffer.from(buildEpub(meta, [{ id: "ch1", title: "Chapter One", doc }]))).toEqual(
      Buffer.from(bytes),
    );
  });
});

describe("more node coverage", () => {
  it("renders ordered lists and images", () => {
    const html = chapterToXhtmlBody({
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
            },
          ],
        },
        { type: "image", attrs: { src: "assets/a.png", alt: 'say "hi"', title: "Cap" } },
      ],
    });
    expect(html).toContain("<ol><li><p>a</p></li></ol>");
    expect(html).toContain('alt="say &quot;hi&quot;"');
    expect(html).toContain("<figcaption>Cap</figcaption>");
  });
  it("emits start on ordered lists only for integers other than 1", () => {
    const ol = (start: string | number) =>
      chapterToXhtmlBody({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start },
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
              },
            ],
          },
        ],
      });
    expect(ol(3)).toContain('<ol start="3">');
    expect(ol(1)).toContain("<ol>");
    expect(ol(2.5)).toContain("<ol>");
    expect(ol("3")).toContain("<ol>");
  });
  it("numbers multiple footnotes in order", () => {
    const fn = (t: string) => ({
      type: "footnote" as const,
      content: [{ type: "text" as const, text: t }],
    });
    const html = chapterToXhtmlBody({
      type: "doc",
      content: [{ type: "paragraph", content: [fn("one"), fn("two")] }],
    });
    expect(html.indexOf('id="fn1"')).toBeLessThan(html.indexOf('id="fn2"'));
  });
});

describe("images", () => {
  const png = new Uint8Array(
    readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
  );
  const img = (src: string) => ({
    type: "image" as const,
    attrs: { src, alt: "A pixel", title: "Caption" },
  });
  const withImages = (...srcs: string[]): ChapterDoc => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }, ...srcs.map(img)],
  });

  it("packages referenced images under OEBPS/assets with media types and manifest items", () => {
    const assets = new Map([
      ["assets/pixel.png", png],
      ["assets/photo.jpg", new Uint8Array([1])],
      ["assets/unused.png", png],
    ]);
    const f = unzipSync(
      buildEpub(
        meta,
        [
          {
            id: "ch1",
            title: "One",
            doc: withImages("assets/pixel.png", "assets/photo.jpg", "assets/pixel.png"),
          },
        ],
        { assets },
      ),
    );
    expect(Buffer.from(f["OEBPS/assets/pixel.png"]!)).toEqual(Buffer.from(png));
    expect(f["OEBPS/assets/photo.jpg"]).toBeDefined();
    expect(f["OEBPS/assets/unused.png"]).toBeUndefined();
    const opf = strFromU8(f["OEBPS/content.opf"]!);
    expect(opf).toContain('href="assets/pixel.png" media-type="image/png"');
    expect(opf).toContain('href="assets/photo.jpg" media-type="image/jpeg"');
    expect(opf.match(/assets\/pixel\.png/g)).toHaveLength(1);
    expect(strFromU8(f["OEBPS/ch1.xhtml"]!)).toContain(
      '<img src="assets/pixel.png" alt="A pixel"/>',
    );
  });
  it("is deterministic with images", () => {
    const o = { assets: new Map([["assets/pixel.png", png]]) };
    const c = [{ id: "ch1", title: "One", doc: withImages("assets/pixel.png") }];
    expect(Buffer.from(buildEpub(meta, c, o))).toEqual(Buffer.from(buildEpub(meta, c, o)));
  });
  it("throws on missing bytes, external urls, traversal and non-image types", () => {
    const build = (src: string) =>
      buildEpub(meta, [{ id: "ch1", title: "One", doc: withImages(src) }], {
        assets: new Map([[src, png]]),
      });
    expect(() =>
      buildEpub(meta, [{ id: "ch1", title: "One", doc: withImages("assets/pixel.png") }]),
    ).toThrow(/Missing image/);
    for (const bad of [
      "https://example.com/a.png",
      "assets/../cadabra.json",
      "assets/a.txt",
      "a.png",
      "",
    ])
      expect(() => build(bad), bad).toThrow(/Unsupported image/);
  });
});

describe("custom stylesheet", () => {
  it("uses the supplied css instead of the default", () => {
    const css = "body{color:#123456}";
    const f = unzipSync(buildEpub(meta, [{ id: "ch1", title: "One", doc }], { css }));
    // The alignment rules follow the supplied css.
    expect(strFromU8(f["OEBPS/style.css"]!).startsWith(`${css}\n`)).toBe(true);
    expect(
      strFromU8(unzipSync(buildEpub(meta, [{ id: "ch1", title: "One", doc }]))["OEBPS/style.css"]!),
    ).not.toBe(css);
  });
});

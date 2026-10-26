import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildEpub, chapterToXhtmlBody } from "./index";

const doc: ChapterDoc = JSON.parse(
  readFileSync(new URL("../../../fixtures/manuscripts/sample-chapter.json", import.meta.url), "utf8"),
);
const meta = { title: "T & Co", author: "A", language: "en", identifier: "urn:uuid:00000000-0000-4000-8000-000000000000", modified: new Date("2026-01-01T00:00:00Z") };

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
  it("rejects unknown nodes instead of dropping them", () => {
    expect(() => chapterToXhtmlBody({ type: "doc", content: [{ type: "footnote" } as never, { type: "bogus" } as never] })).toThrow(/Unsupported/);
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
    for (const p of ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/ch1.xhtml", "OEBPS/style.css"]) expect(f[p]).toBeDefined();
    expect(strFromU8(f["OEBPS/content.opf"]!)).toContain("<dc:title>T &amp; Co</dc:title>");
  });
  it("is deterministic", () => {
    expect(Buffer.from(buildEpub(meta, [{ id: "ch1", title: "Chapter One", doc }]))).toEqual(Buffer.from(bytes));
  });
});

describe("more node coverage", () => {
  it("clamps heading levels and renders ordered lists and images", () => {
    const html = chapterToXhtmlBody({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "H" }] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
        { type: "image", attrs: { src: "assets/a.png", alt: 'say "hi"', title: "Cap" } },
      ],
    });
    expect(html).toContain("<h3>H</h3>");
    expect(html).toContain("<ol><li><p>a</p></li></ol>");
    expect(html).toContain('alt="say &quot;hi&quot;"');
    expect(html).toContain("<figcaption>Cap</figcaption>");
  });
  it("numbers multiple footnotes in order", () => {
    const fn = (t: string) => ({ type: "footnote" as const, content: [{ type: "text" as const, text: t }] });
    const html = chapterToXhtmlBody({ type: "doc", content: [{ type: "paragraph", content: [fn("one"), fn("two")] }] });
    expect(html.indexOf('id="fn1"')).toBeLessThan(html.indexOf('id="fn2"'));
  });
});

import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildEpub } from "../index";

const meta = {
  title: "The Long Quay",
  author: "A",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};
const doc = (...c: ChapterDoc["content"]): ChapterDoc => ({ type: "doc", content: c });
const chapter = {
  id: "ch1",
  title: "One",
  doc: doc({ type: "paragraph", content: [{ type: "text", text: "Hello" }] }),
};
const cover = { path: "assets/cover.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };
const read = (b: Uint8Array) => {
  const f = unzipSync(b);
  const text = (p: string) => strFromU8(f[p]!);
  return { f, opf: text("OEBPS/content.opf"), nav: text("OEBPS/nav.xhtml"), text };
};

describe("EPUB cover", () => {
  const { f, opf, nav, text } = read(buildEpub(meta, [chapter], { cover }));
  it("stores the image once, under its project path", () => {
    expect([...f["OEBPS/assets/cover.jpg"]!]).toEqual([...cover.bytes]);
  });
  it("declares it as the cover image, for EPUB 3 readers and older ones", () => {
    expect(opf).toContain(
      '<item id="epub-cover-image" href="assets/cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
    );
    expect(opf).toContain('<meta name="cover" content="epub-cover-image"/>');
  });
  it("adds a cover page first in the reading order, before the chapters", () => {
    expect(opf).toContain(
      '<item id="epub-cover" href="epub-cover.xhtml" media-type="application/xhtml+xml"/>',
    );
    expect(opf).toMatch(/<spine><itemref idref="epub-cover"\/><itemref idref="ch1"\/>/);
    const page = text("OEBPS/epub-cover.xhtml");
    expect(page).toContain('epub:type="cover"');
    expect(page).toContain(
      '<img role="doc-cover" src="assets/cover.jpg" alt="Cover: The Long Quay"',
    );
  });
  it("lists it as a landmark but not in the table of contents", () => {
    expect(nav).toContain('<a epub:type="cover" href="epub-cover.xhtml">Cover</a>');
    expect(nav).not.toContain('<li><a href="epub-cover.xhtml">');
  });
  it("uses the language of the book for the label", () => {
    const fr = read(buildEpub({ ...meta, language: "fr" }, [chapter], { cover }));
    expect(fr.nav).toContain(">Couverture</a>");
    expect(fr.text("OEBPS/epub-cover.xhtml")).toContain('alt="Couverture: The Long Quay"');
  });
  it("is deterministic", () => {
    expect(Buffer.from(buildEpub(meta, [chapter], { cover }))).toEqual(
      Buffer.from(buildEpub(meta, [chapter], { cover })),
    );
  });
});

describe("EPUB without a cover", () => {
  it("has no cover page, item, meta or landmark", () => {
    const { f, opf, nav } = read(buildEpub(meta, [chapter]));
    expect(f["OEBPS/epub-cover.xhtml"]).toBeUndefined();
    expect(opf).not.toMatch(/cover/);
    expect(nav).not.toContain('epub:type="cover"');
  });
});

describe("EPUB cover that a chapter also uses", () => {
  it("is one file and one manifest item", () => {
    const withImage = {
      ...chapter,
      doc: doc({ type: "image", attrs: { src: cover.path, alt: "again" } }),
    };
    const { f, opf } = read(
      buildEpub(meta, [withImage], { cover, assets: new Map([[cover.path, cover.bytes]]) }),
    );
    expect(Object.keys(f).filter((k) => k.endsWith("cover.jpg"))).toEqual([
      "OEBPS/assets/cover.jpg",
    ]);
    expect(opf.match(/href="assets\/cover\.jpg"/g)).toHaveLength(1);
  });
});

describe("EPUB cover validation", () => {
  it.each(["assets/c.gif", "assets/c.svg", "assets/c.txt", "/abs/c.jpg", "../c.jpg", "c.jpg"])(
    "refuses %s",
    (path) => {
      expect(() => buildEpub(meta, [chapter], { cover: { path, bytes: cover.bytes } })).toThrow(
        /Unsupported cover/,
      );
    },
  );
  it("accepts png and webp", () => {
    for (const ext of ["png", "webp"])
      expect(() =>
        buildEpub(meta, [chapter], { cover: { path: `assets/c.${ext}`, bytes: cover.bytes } }),
      ).not.toThrow();
  });
});

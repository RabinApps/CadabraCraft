import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildEpub, chapterToXhtmlBody, EpubExportError } from "../index";

const doc: ChapterDoc = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/manuscripts/sample-chapter.json", import.meta.url),
    "utf8",
  ),
);
const meta = {
  title: "T",
  author: "A",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};

describe("ISBN", () => {
  const opf = (m: typeof meta & { isbn?: string | null }) =>
    strFromU8(unzipSync(buildEpub(m, [{ id: "ch1", title: "One", doc }]))["OEBPS/content.opf"]!);
  it("adds a urn:isbn identifier after the unique one and keeps unique-identifier on the book id", () => {
    const x = opf({ ...meta, isbn: "978-3-16-148410-0" });
    expect(x).toContain(
      '<dc:identifier id="bookid">urn:uuid:00000000-0000-4000-8000-000000000000</dc:identifier><dc:identifier>urn:isbn:9783161484100</dc:identifier>',
    );
    expect(x).toContain('unique-identifier="bookid"');
  });
  it("converts an ISBN-10", () => {
    expect(opf({ ...meta, isbn: "0-306-40615-2" })).toContain("urn:isbn:9780306406157");
  });
  it("skips absent, empty, invalid and duplicate ISBNs", () => {
    for (const isbn of [undefined, null, "", "978-3-16-148410-1", "nope"])
      expect(opf({ ...meta, isbn }), String(isbn)).not.toContain("urn:isbn");
    const same = opf({ ...meta, identifier: "urn:isbn:9783161484100", isbn: "978-3-16-148410-0" });
    expect(same.match(/urn:isbn:9783161484100/g)).toHaveLength(1);
  });
});

describe("retail metadata", () => {
  const opf = (publishing?: object) =>
    strFromU8(
      unzipSync(buildEpub({ ...meta, publishing }, [{ id: "ch1", title: "One", doc }]))[
        "OEBPS/content.opf"
      ]!,
    );
  it("writes nothing for no publishing details, an empty object or unset keys", () => {
    for (const x of [opf(), opf({})]) {
      expect(x).not.toMatch(/dc:(publisher|description|subject|rights|date)|belongs-to-collection/);
    }
  });
  it("writes publisher, description, each subject, rights and the date after the language", () => {
    const x = opf({
      publisher: "Quay Press",
      description: "Line one.\nLine two & <more>.",
      subjects: ["FIC014000", "Light & sea"],
      rights: "© 2026 A. Writer",
      published: "2026-11-03",
    });
    expect(x).toContain(
      '<dc:language>en</dc:language><dc:publisher>Quay Press</dc:publisher><dc:description>Line one.\nLine two &amp; &lt;more&gt;.</dc:description><dc:subject>FIC014000</dc:subject><dc:subject>Light &amp; sea</dc:subject><dc:rights>© 2026 A. Writer</dc:rights><dc:date>2026-11-03</dc:date><meta property="dcterms:modified">',
    );
  });
  it("writes the series as an EPUB 3 collection with its position", () => {
    const x = opf({ series: "Harbour <Lights>", seriesNumber: "2.5" });
    expect(x).toContain(
      '<meta property="belongs-to-collection" id="series">Harbour &lt;Lights&gt;</meta><meta refines="#series" property="collection-type">series</meta><meta refines="#series" property="group-position">2.5</meta>',
    );
  });
  it("writes a series without a position when none is set", () => {
    const x = opf({ series: "Harbour Lights" });
    expect(x).toContain('property="collection-type">series</meta>');
    expect(x).not.toContain("group-position");
  });
  it("is deterministic for the same details", () => {
    const p = { publisher: "P", subjects: ["a", "b"], series: "S", seriesNumber: "1" };
    expect(opf(p)).toBe(opf(p));
  });
});

describe("accessibility metadata", () => {
  const png = new Uint8Array(
    readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
  );
  const text: ChapterDoc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
  };
  const withImage = (alt: string | undefined): ChapterDoc => ({
    type: "doc",
    content: [
      ...text.content,
      { type: "image", attrs: { src: "assets/pixel.png", ...(alt === undefined ? {} : { alt }) } },
    ],
  });
  const opf = (d: ChapterDoc, extra = {}) =>
    strFromU8(
      unzipSync(
        buildEpub(meta, [{ id: "ch1", title: "One", doc: d }], {
          assets: new Map([["assets/pixel.png", png]]),
          ...extra,
        }),
      )["OEBPS/content.opf"]!,
    );
  const props = (x: string, p: string) =>
    [...x.matchAll(new RegExp(`<meta property="schema:${p}"[^>]*>([^<]*)</meta>`, "g"))].map(
      (m) => m[1],
    );

  it("describes a text-only book without claiming alternative text or visual mode", () => {
    const x = opf(text);
    expect(props(x, "accessMode")).toEqual(["textual"]);
    expect(props(x, "accessModeSufficient")).toEqual(["textual"]);
    expect(props(x, "accessibilityFeature")).toEqual([
      "tableOfContents",
      "readingOrder",
      "structuralNavigation",
      "displayTransformability",
    ]);
    expect(props(x, "accessibilityHazard")).toEqual(["none"]);
    expect(props(x, "accessibilitySummary")[0]).toContain("no images");
    expect(x).not.toContain("conformsTo");
  });
  it("claims alternativeText and visual mode only when every image has alt text", () => {
    const x = opf(withImage("A pixel"));
    expect(props(x, "accessMode")).toEqual(["textual", "visual"]);
    expect(props(x, "accessibilityFeature")).toContain("alternativeText");
    expect(props(x, "accessModeSufficient")).toEqual(["textual"]);
  });
  it("drops alternativeText and says text alone is not sufficient when an image lacks alt", () => {
    for (const alt of [undefined, "", "  "]) {
      const x = opf(withImage(alt));
      expect(props(x, "accessibilityFeature"), String(alt)).not.toContain("alternativeText");
      expect(props(x, "accessModeSufficient")).toEqual(["textual,visual"]);
      expect(props(x, "accessibilitySummary")[0]).toContain("no alternative text");
    }
  });
  it("counts a cover as a visual with alt text", () => {
    const x = opf(text, { cover: { path: "assets/cover.png", bytes: png } });
    expect(props(x, "accessMode")).toEqual(["textual", "visual"]);
    expect(props(x, "accessibilityFeature")).toContain("alternativeText");
  });
  it("is deterministic", () => {
    expect(opf(withImage("a"))).toBe(opf(withImage("a")));
  });
});

describe("EpubExportError", () => {
  const nested: ChapterDoc = {
    type: "doc",
    content: [
      { type: "paragraph" },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [{ type: "bogus" } as never] }],
      },
    ],
  };
  it("names the node type and where it is, never dropping the node", () => {
    const err = (() => {
      try {
        chapterToXhtmlBody(nested);
      } catch (e) {
        return e;
      }
    })() as EpubExportError;
    expect(err).toBeInstanceOf(EpubExportError);
    expect(err.code).toBe("unsupported-node");
    expect(err.where).toEqual({ nodeType: "bogus", path: "bulletList 2 > listItem 1 > bogus 1" });
  });
  it("adds the page from buildEpub", () => {
    const err = (() => {
      try {
        buildEpub(meta, [
          { id: "ch1", title: "One", doc },
          { id: "ch2", title: "Two", doc: nested },
        ]);
      } catch (e) {
        return e;
      }
    })() as EpubExportError;
    expect(err).toBeInstanceOf(EpubExportError);
    expect(err.where.chapter).toEqual({ id: "ch2", title: "Two" });
    expect(err.message).toBe(
      'In "Two": Unsupported node type in chapter: bogus (at bulletList 2 > listItem 1 > bogus 1)',
    );
  });
  it("reports unknown marks and table cells with their place", () => {
    const bad = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "wiggle" }] }] },
      ],
    } as unknown as ChapterDoc;
    expect(() => chapterToXhtmlBody(bad)).toThrow(
      expect.objectContaining({
        code: "unsupported-mark",
        where: { nodeType: "mark wiggle", path: "paragraph 1 > text 1" },
      }),
    );
    const cell = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [{ type: "bulletList" }] }],
            },
          ],
        },
      ],
    } as unknown as ChapterDoc;
    expect(() => chapterToXhtmlBody(cell)).toThrow(
      expect.objectContaining({
        code: "unsupported-node",
        where: {
          nodeType: "bulletList",
          path: "table 1 > tableRow 1 > tableCell 1 > bulletList 1",
        },
      }),
    );
  });
  it("names the page for a missing image", () => {
    const d: ChapterDoc = {
      type: "doc",
      content: [{ type: "image", attrs: { src: "assets/a.png" } }],
    };
    expect(() => buildEpub(meta, [{ id: "ch1", title: "One", doc: d }])).toThrow(
      expect.objectContaining({
        code: "missing-image",
        where: expect.objectContaining({ chapter: { id: "ch1", title: "One" } }),
      }),
    );
  });
});

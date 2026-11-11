import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listTemplates } from "@cadabracraft/templates";
import {
  buildGlossary,
  buildIndex,
  collectGlossaryUses,
  collectIndexMarks,
  type ChapterDoc,
} from "@cadabracraft/shared";
import { buildEpub, type EpubChapter } from "../index";
import { matterBook } from "./matterBook";

const jar = fileURLToPath(
  new URL("../../../../tools/epubcheck-5.4.0/epubcheck.jar", import.meta.url),
);
// Each check starts a JVM (about 3 s alone). `pnpm test` runs every package at once, which can make a cold JVM several times slower.
const JVM_TIMEOUT = 120_000;
const doc = JSON.parse(
  readFileSync(
    new URL("../../../../fixtures/manuscripts/sample-chapter.json", import.meta.url),
    "utf8",
  ),
);

// Run scripts/fetch-epubcheck.sh first. CI always fetches it; set REQUIRE_EPUBCHECK=1 to fail instead of skip.
describe.skipIf(!existsSync(jar) && !process.env.REQUIRE_EPUBCHECK)("EPUBCheck", () => {
  it(
    "validates the sample EPUB with zero messages",
    () => {
      const f = join(mkdtempSync(join(tmpdir(), "epub-")), "s.epub");
      writeFileSync(
        f,
        buildEpub(
          {
            title: "S",
            author: "A",
            language: "en",
            identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11",
            modified: new Date(),
          },
          [{ id: "ch1", title: "One", doc }],
        ),
      );
      const out = execFileSync("java", ["-jar", jar, f], { encoding: "utf8" });
      expect(out).toContain("No errors or warnings detected");
    },
    JVM_TIMEOUT,
  );

  it(
    "validates an EPUB containing images with zero messages",
    () => {
      const f = join(mkdtempSync(join(tmpdir(), "epub-")), "img.epub");
      const png = new Uint8Array(
        readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
      );
      const withImage = {
        ...doc,
        content: [
          ...doc.content,
          {
            type: "image",
            attrs: { src: "assets/pixel.png", alt: "A single pixel", title: "A caption" },
          },
        ],
      };
      writeFileSync(
        f,
        buildEpub(
          {
            title: "S",
            author: "A",
            language: "en",
            identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11",
            modified: new Date(),
          },
          [{ id: "ch1", title: "One", doc: withImage }],
          { assets: new Map([["assets/pixel.png", png]]) },
        ),
      );
      const out = execFileSync("java", ["-jar", jar, f], { encoding: "utf8" });
      expect(out).toContain("No errors or warnings detected");
    },
    JVM_TIMEOUT,
  );

  const metaOf = (language: string) => ({
    title: "S",
    author: "A",
    language,
    identifier: "urn:uuid:5b1d1d2c-6f0a-4c43-9a55-1f0d3c8d3a11",
    modified: new Date(),
  });
  const check = (name: string, bytes: Uint8Array): string => {
    const f = join(mkdtempSync(join(tmpdir(), "epub-")), name);
    writeFileSync(f, bytes);
    return execFileSync("java", ["-jar", jar, f], { encoding: "utf8" });
  };

  it(
    "validates a book with every kind of front and back matter, with every template stylesheet",
    () => {
      for (const t of listTemplates()) {
        const out = check(
          `matter-${t.id}.epub`,
          buildEpub(metaOf("en"), matterBook(), { css: t.epub.css }),
        );
        expect(out, t.id).toContain("No errors or warnings detected");
      }
    },
    JVM_TIMEOUT,
  );

  it(
    "validates vertically centred pages (the vcenter class and its flex rule) with every template stylesheet, left-to-right and right-to-left",
    () => {
      // The template's kinds, plus a foreword and an about-the-author page the author centred.
      const pages = matterBook().map((c) =>
        c.kind === "foreword" || c.kind === "about-the-author" ? { ...c, verticalCenter: true } : c,
      );
      for (const t of listTemplates())
        for (const language of ["en", "he"]) {
          const bytes = buildEpub(metaOf(language), pages, {
            css: t.epub.css,
            centerKinds: t.print.matter.verticalCenter,
          });
          expect(check(`vcenter-${t.id}-${language}.epub`, bytes), `${t.id} ${language}`).toContain(
            "No errors or warnings detected",
          );
        }
      // The built-in default stylesheet has the same rules.
      expect(
        check(
          "vcenter-default.epub",
          buildEpub(metaOf("en"), pages, { centerKinds: ["title-page", "dedication", "epigraph"] }),
        ),
      ).toContain("No errors or warnings detected");
    },
    JVM_TIMEOUT,
  );

  it(
    "validates a book with a cover, left-to-right, right-to-left and with front matter only",
    () => {
      const png = new Uint8Array(
        readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
      );
      const withCover = (language: string, path: string) =>
        buildEpub(metaOf(language), matterBook(), { cover: { path, bytes: png } });
      expect(check("cover-en.epub", withCover("en", "assets/cover.png"))).toContain(
        "No errors or warnings detected",
      );
      expect(check("cover-he.epub", withCover("he", "assets/cover.png"))).toContain(
        "No errors or warnings detected",
      );
      expect(
        check(
          "cover-only.epub",
          buildEpub(metaOf("en"), matterBook().slice(0, 1), {
            cover: { path: "assets/cover.png", bytes: png },
          }),
        ),
      ).toContain("No errors or warnings detected");
    },
    JVM_TIMEOUT,
  );

  it(
    "validates a book with a contents page: nested headings, hidden, custom and unlinked entries, left-to-right and right-to-left, every template stylesheet",
    () => {
      const h = (level: number, text: string) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text }],
      });
      const d = (...content: object[]) => ({ type: "doc", content }) as typeof doc;
      const chapters = [
        {
          id: "toc",
          title: "Contents",
          doc: d(h(1, "Contents")),
          section: "front",
          kind: "contents",
        },
        {
          id: "ch-1",
          title: "One",
          doc: d(h(1, "One"), h(2, "Storm"), h(3, "Deep"), h(2, "Calm")),
        },
        { id: "ch-2", title: "Two", doc: d(h(1, "Two"), h(2, "Storm")) },
        {
          id: "bm-1",
          title: "Thanks",
          doc: d(h(1, "Thanks")),
          section: "back",
          kind: "acknowledgments",
        },
      ] as Parameters<typeof buildEpub>[1];
      const contents = [
        { kind: "page", entryId: "ch-1", level: 0, title: "One" },
        { kind: "heading", entryId: "ch-1", level: 1, title: "Storm", index: 1 },
        { kind: "heading", entryId: "ch-1", level: 2, title: "Deep", index: 2 },
        { kind: "heading", entryId: "ch-1", level: 1, title: "Calm", index: 3 },
        { kind: "page", entryId: "ch-2", level: 0, title: "Two (renamed) <&>" },
        { kind: "page", entryId: "ch-2", level: 0, title: "Hidden", hidden: true },
        { kind: "custom", entryId: "bm-1", level: 0, title: "Author’s note" },
        { kind: "custom", level: 0, title: "A line pointing nowhere" },
        { kind: "page", entryId: "bm-1", level: 0, title: "Thanks" },
      ] as NonNullable<Parameters<typeof buildEpub>[2]>["contents"];
      for (const language of ["en", "he"]) {
        for (const t of listTemplates()) {
          const out = check(
            `contents-${language}-${t.id}.epub`,
            buildEpub(metaOf(language), chapters, { css: t.epub.css, contents }),
          );
          expect(out, `${language} ${t.id}`).toContain("No errors or warnings detected");
        }
      }
    },
    JVM_TIMEOUT * 3,
  );

  it(
    "validates a contents page with a custom entry that targets a heading and entries with blank titles",
    () => {
      const h = (level: number, text: string) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text }],
      });
      const d = (...content: object[]) => ({ type: "doc", content }) as typeof doc;
      const chapters = [
        {
          id: "toc",
          title: "Contents",
          doc: d(h(1, "Contents")),
          section: "front",
          kind: "contents",
        },
        { id: "ch-1", title: "One", doc: d(h(1, "One"), h(2, "Storm"), h(2, "Calm")) },
      ] as Parameters<typeof buildEpub>[1];
      const contents = [
        { kind: "page", entryId: "ch-1", level: 0, title: "  " },
        { kind: "heading", entryId: "ch-1", level: 1, title: "", index: 1 },
        { kind: "custom", entryId: "ch-1", level: 0, title: "", targetIndex: 1 },
        { kind: "custom", entryId: "ch-1", level: 0, title: "Jump to calm", targetIndex: 2 },
        { kind: "custom", level: 0, title: "" },
      ] as NonNullable<Parameters<typeof buildEpub>[2]>["contents"];
      expect(
        check("contents-target-blank.epub", buildEpub(metaOf("en"), chapters, { contents })),
      ).toContain("No errors or warnings detected");
    },
    JVM_TIMEOUT,
  );

  it(
    "validates the retail metadata: publisher, description, subjects, rights, date and a series",
    () => {
      const retail = {
        publisher: "Quay Press",
        description: "A keeper, a storm & a <disputed> light.\nBook one.",
        subjects: ["FIC014000", "Lighthouses"],
        rights: "© 2026 A. Writer. All rights reserved.",
        published: "2026-11-03",
      };
      for (const [name, publishing] of [
        ["retail-series.epub", { ...retail, series: "Harbour Lights", seriesNumber: "2.5" }],
        ["retail-series-only.epub", { series: "Harbour Lights" }],
        ["retail.epub", retail],
      ] as const)
        expect(
          check(
            name,
            buildEpub({ ...metaOf("en"), publishing }, [{ id: "ch1", title: "One", doc }]),
          ),
        ).toContain("No errors or warnings detected");
    },
    JVM_TIMEOUT,
  );

  it(
    "validates an ISBN, images without alt text, a cover and a GIF, all with accessibility metadata",
    () => {
      const png = new Uint8Array(
        readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
      );
      const img = (src: string, alt?: string) => ({
        type: "image",
        attrs: { src, ...(alt === undefined ? {} : { alt }) },
      });
      const noAlt = {
        ...doc,
        content: [...doc.content, img("assets/pixel.png"), img("assets/b.png", "  ")],
      };
      const assets = new Map([
        ["assets/pixel.png", png],
        ["assets/b.png", png],
      ]);
      const m = { ...metaOf("en"), isbn: "978-3-16-148410-0" };
      expect(
        check("alt.epub", buildEpub(m, [{ id: "ch1", title: "One", doc: noAlt }], { assets })),
      ).toContain("No errors or warnings detected");
      expect(
        check(
          "alt-cover.epub",
          buildEpub(m, [{ id: "ch1", title: "One", doc: noAlt }], {
            assets,
            cover: { path: "assets/cover.png", bytes: png },
          }),
        ),
      ).toContain("No errors or warnings detected");
      const withAlt = { ...doc, content: [...doc.content, img("assets/pixel.png", "A pixel")] };
      expect(
        check(
          "isbn10.epub",
          buildEpub({ ...m, isbn: "0-306-40615-2" }, [{ id: "ch1", title: "One", doc: withAlt }], {
            assets,
          }),
        ),
      ).toContain("No errors or warnings detected");
      const gif = { ...doc, content: [...doc.content, img("assets/g.gif", "A gif")] };
      expect(
        check(
          "gif.epub",
          buildEpub(m, [{ id: "ch1", title: "One", doc: gif }], {
            assets: new Map([
              [
                "assets/g.gif",
                new Uint8Array(
                  Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
                ),
              ],
            ]),
          }),
        ),
      ).toContain("No errors or warnings detected");
    },
    JVM_TIMEOUT,
  );

  it(
    "validates matter-only and right-to-left books",
    () => {
      expect(check("front-only.epub", buildEpub(metaOf("en"), matterBook().slice(0, 1)))).toContain(
        "No errors or warnings detected",
      );
      expect(check("he.epub", buildEpub(metaOf("he"), matterBook()))).toContain(
        "No errors or warnings detected",
      );
    },
    JVM_TIMEOUT,
  );

  it(
    "validates an index and a glossary page placed in the back matter, and the same lists at the end",
    () => {
      const mark = (type: string, attrs: Record<string, string>) => ({ type, attrs });
      const para = (...content: unknown[]) => ({ type: "paragraph", content });
      const chapter = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] },
          para(
            {
              type: "text",
              text: "wall",
              marks: [mark("indexEntry", { id: "a", term: "Orchard" })],
            },
            { type: "text", text: " " },
            { type: "text", text: "quay", marks: [mark("glossaryTerm", { id: "quay" })] },
          ),
        ],
      } as ChapterDoc;
      const sources = [{ id: "ch-1", doc: chapter }];
      const lists = {
        index: {
          heading: "Index",
          letterHeadings: true,
          ranges: true,
          columns: 2 as const,
          tree: buildIndex(collectIndexMarks(sources)),
        },
        glossary: {
          heading: "Glossary",
          markFirstUse: true,
          items: buildGlossary(
            [{ id: "quay", term: "Quay", definition: "A landing place." }],
            collectGlossaryUses(sources),
          ).items,
        },
      };
      const empty = { type: "doc", content: [] } as ChapterDoc;
      const placed: EpubChapter[] = [
        { id: "ch-1", title: "One", doc: chapter },
        { id: "bm-1", title: "Index", doc: empty, section: "back", kind: "index" },
        { id: "bm-2", title: "Glossary", doc: empty, section: "back", kind: "glossary" },
      ];
      for (const language of ["en", "he"]) {
        for (const [name, pages] of [
          ["placed", placed],
          ["appended", placed.slice(0, 1)],
        ] as const)
          expect(
            check(`index-${name}-${language}.epub`, buildEpub(metaOf(language), pages, lists)),
            `${name} ${language}`,
          ).toContain("No errors or warnings detected");
      }
    },
    JVM_TIMEOUT,
  );
});

import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildEpub, type EpubChapter } from "../index";
import { matterBook } from "./matterBook";

const meta = {
  title: "The Long Quay",
  author: "A. Writer",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};
const doc = (t: string): ChapterDoc => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: t }] },
    { type: "paragraph", content: [{ type: "text", text: `${t} text` }] },
  ],
});
const book = matterBook;

const parts = (chapters: EpubChapter[], language = "en") =>
  unzipSync(buildEpub({ ...meta, language }, chapters));
const text = (f: ReturnType<typeof parts>, p: string) => strFromU8(f[p]!);
const bodyTag = (f: ReturnType<typeof parts>, id: string) =>
  /<body[^>]*>/.exec(text(f, `OEBPS/${id}.xhtml`))![0];

describe("front and back matter in the EPUB", () => {
  const f = parts(book());
  it("spine follows the given reading order and skips nothing", () => {
    const opf = text(f, "OEBPS/content.opf");
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"\/>/g)].map((m) => m[1]);
    expect(spine).toEqual(book().map((c) => c.id)); // the nav document follows as a non-linear item
    expect(opf).toContain('<itemref idref="nav" linear="no"/></spine>');
    for (const c of book())
      expect(opf).toContain(
        `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`,
      );
  });
  it("puts epub:type semantics on every page's body", () => {
    const expected: Record<string, string> = {
      "fm-1": "frontmatter titlepage",
      "fm-2": "frontmatter copyright-page",
      "fm-3": "frontmatter dedication",
      "fm-4": "frontmatter epigraph",
      "fm-5": "frontmatter foreword",
      "fm-6": "frontmatter preface",
      "fm-7": "frontmatter",
      "ch-1": "bodymatter chapter",
      "ch-2": "bodymatter chapter",
      "bm-1": "backmatter acknowledgments",
      "bm-2": "backmatter",
      "bm-3": "backmatter",
      "bm-4": "backmatter colophon",
      "bm-5": "backmatter",
    };
    for (const [id, type] of Object.entries(expected))
      expect(bodyTag(f, id), id).toContain(`epub:type="${type}"`);
  });
  it("adds a body class per kind so stylesheets can target pages", () => {
    expect(bodyTag(f, "fm-1")).toContain('class="title-page"');
    expect(bodyTag(f, "fm-2")).toContain('class="copyright"');
    expect(bodyTag(f, "ch-1")).toContain('class="chapter"');
    expect(bodyTag(f, "bm-2")).toContain('class="about-the-author"');
    expect(bodyTag(f, "fm-7")).toContain('class="custom"');
  });
  it("lists chapters and reading sections in the TOC, but not title page, copyright, dedication, epigraph or colophon", () => {
    const nav = text(f, "OEBPS/nav.xhtml");
    const toc = /<nav epub:type="toc"[\s\S]*?<\/nav>/.exec(nav)![0];
    const hrefs = [...toc.matchAll(/<a href="([^"]+)">/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "fm-5.xhtml",
      "fm-6.xhtml",
      "fm-7.xhtml",
      "ch-1.xhtml",
      "ch-2.xhtml",
      "bm-1.xhtml",
      "bm-2.xhtml",
      "bm-3.xhtml",
      "bm-5.xhtml",
    ]);
    expect(toc).toContain(">Foreword</a>");
    expect(toc).not.toMatch(/Title Page|Copyright|Dedication|Epigraph|Colophon/);
  });
  it("has landmarks for the start of the content and the table of contents", () => {
    const nav = text(f, "OEBPS/nav.xhtml");
    const landmarks = /<nav epub:type="landmarks"[\s\S]*?<\/nav>/.exec(nav)![0];
    expect(landmarks).toContain('hidden="hidden"');
    expect(landmarks).toContain('<a epub:type="bodymatter" href="ch-1.xhtml">Start of content</a>');
    expect(landmarks).toContain('<a epub:type="toc" href="nav.xhtml#toc">Contents</a>');
  });
  it("is deterministic", () => {
    expect(Buffer.from(buildEpub(meta, book()))).toEqual(Buffer.from(buildEpub(meta, book())));
  });
  it("a book without any matter still produces chapter pages marked bodymatter", () => {
    const g = parts([{ id: "ch1", title: "One", doc: doc("One") }]);
    expect(bodyTag(g, "ch1")).toContain('epub:type="bodymatter chapter"');
    expect(text(g, "OEBPS/nav.xhtml")).toContain('<a epub:type="bodymatter" href="ch1.xhtml">');
  });
  it("starts the content landmark at the first listed page when there are no chapters", () => {
    const only = parts([
      { id: "fm-1", title: "Title Page", doc: doc("T"), section: "front", kind: "title-page" },
      { id: "bm-1", title: "About", doc: doc("A"), section: "back", kind: "about-the-author" },
    ]);
    const nav = text(only, "OEBPS/nav.xhtml");
    expect(nav).toContain('<a epub:type="bodymatter" href="bm-1.xhtml">');
    expect(/<nav epub:type="toc"[\s\S]*?<\/nav>/.exec(nav)![0]).toContain('href="bm-1.xhtml"');
  });
  it("never leaves the TOC empty when only unlisted pages exist", () => {
    const g = parts([
      { id: "fm-1", title: "Title Page", doc: doc("T"), section: "front", kind: "title-page" },
    ]);
    expect(/<nav epub:type="toc"[\s\S]*?<\/nav>/.exec(text(g, "OEBPS/nav.xhtml"))![0]).toContain(
      'href="fm-1.xhtml"',
    );
  });
  it("localizes landmark labels and keeps right-to-left direction on matter pages", () => {
    const he = parts(book(), "he");
    expect(text(he, "OEBPS/nav.xhtml")).toContain(">תחילת התוכן</a>");
    expect(text(he, "OEBPS/fm-1.xhtml")).toContain('dir="rtl"');
    expect(text(parts(book(), "de"), "OEBPS/nav.xhtml")).toContain(">Beginn des Inhalts</a>");
  });
  it("rejects a kind in the wrong section", () => {
    expect(() =>
      buildEpub(meta, [
        { id: "x", title: "X", doc: doc("X"), section: "back", kind: "dedication" },
      ]),
    ).toThrow(/dedication/);
    expect(() => buildEpub(meta, [{ id: "x", title: "X", doc: doc("X"), kind: "custom" }])).toThrow(
      /chapter/,
    );
  });
  it("still throws on unknown nodes in matter pages", () => {
    expect(() =>
      buildEpub(meta, [
        {
          id: "fm-1",
          title: "T",
          doc: { type: "doc", content: [{ type: "bogus" } as never] },
          section: "front",
          kind: "custom",
        },
      ]),
    ).toThrow(/Unsupported/);
  });
});

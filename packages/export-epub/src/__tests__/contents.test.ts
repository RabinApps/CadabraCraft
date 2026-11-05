import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { TOC_UNLISTED_KINDS } from "@cadabracraft/format";
import { buildEpub, EpubExportError, type ContentsItem, type EpubChapter } from "../index";
import { matterBook } from "./matterBook";

const meta = {
  title: "The Long Quay",
  author: "A. Writer",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};
const h = (level: number, text: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const p = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });

const book = (): EpubChapter[] => [
  {
    id: "fm-1",
    title: "Title Page",
    doc: doc(h(1, "Title Page")),
    section: "front",
    kind: "title-page",
  },
  { id: "toc", title: "Contents", doc: doc(h(1, "Contents")), section: "front", kind: "contents" },
  {
    id: "ch-1",
    title: "One",
    doc: doc(h(1, "One"), p("x"), h(2, "Storm"), h(3, "Deep"), h(2, "Calm")),
  },
  { id: "ch-2", title: "Two", doc: doc(h(1, "Two"), h(2, ""), h(2, "Storm")) },
  {
    id: "bm-1",
    title: "Thanks",
    doc: doc(h(1, "Thanks")),
    section: "back",
    kind: "acknowledgments",
  },
];

const page = (id: string, title: string, level = 0): ContentsItem => ({
  kind: "page",
  entryId: id,
  level,
  title,
});
const heading = (id: string, level: number, title: string, index: number): ContentsItem => ({
  kind: "heading",
  entryId: id,
  level,
  title,
  index,
});

const files = (chapters: EpubChapter[], contents?: readonly ContentsItem[], language = "en") =>
  unzipSync(buildEpub({ ...meta, language }, chapters, contents === undefined ? {} : { contents }));
const text = (f: ReturnType<typeof files>, path: string) => strFromU8(f[path]!);
const nav = (f: ReturnType<typeof files>) => text(f, "OEBPS/nav.xhtml");
const navList = (f: ReturnType<typeof files>) =>
  /<nav epub:type="toc"[^>]*>(.*?)<\/nav>/s.exec(nav(f))![1]!;
const spine = (f: ReturnType<typeof files>) =>
  [...text(f, "OEBPS/content.opf").matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);

const chapters0 = [page("ch-1", "One"), page("ch-2", "Two"), page("bm-1", "Thanks")];

describe("EPUB contents page", () => {
  it("writes a part divider as an epub:type part page and keeps it in the spine and nav", () => {
    const withPart: EpubChapter[] = [
      { id: "pt-1", title: "Part One", kind: "part", doc: doc(h(1, "Part One")) },
      ...book(),
    ];
    const f = files(withPart, [page("pt-1", "Part One"), ...chapters0]);
    expect(text(f, "OEBPS/pt-1.xhtml")).toContain('epub:type="bodymatter part" class="part-page"');
    expect(spine(f)).toContain("pt-1");
    expect(navList(f)).toContain('<a href="pt-1.xhtml">Part One</a>');
  });
  it("writes a linked list on the contents page, at its place in the reading order", () => {
    const f = files(book(), chapters0);
    expect(spine(f)).toEqual(["fm-1", "toc", "ch-1", "ch-2", "bm-1", "nav"]);
    const xhtml = text(f, "OEBPS/toc.xhtml");
    expect(xhtml).toContain('<h1 id="h-0">Contents</h1>');
    expect(xhtml).toContain(
      '<nav epub:type="toc" role="doc-toc" class="contents" aria-labelledby="h-0"><ol role="list"><li><a href="ch-1.xhtml">One</a></li><li><a href="ch-2.xhtml">Two</a></li><li><a href="bm-1.xhtml">Thanks</a></li></ol></nav>',
    );
    expect(xhtml).toContain('epub:type="frontmatter"');
    expect(text(f, "OEBPS/content.opf")).toContain('<item id="toc" href="toc.xhtml"');
  });

  it("builds the navigation document from the same list", () => {
    const f = files(book(), chapters0);
    expect(navList(f)).toBe(
      '<h1>Contents</h1><ol><li><a href="ch-1.xhtml">One</a></li><li><a href="ch-2.xhtml">Two</a></li><li><a href="bm-1.xhtml">Thanks</a></li></ol>',
    );
    expect(nav(f)).toContain('href="nav.xhtml#toc"');
  });

  it("nests headings by level and links them to heading ids (depth 1 to 3)", () => {
    const items = [
      page("ch-1", "One"),
      heading("ch-1", 1, "One", 0),
      heading("ch-1", 2, "Storm", 1),
      heading("ch-1", 3, "Deep", 2),
      heading("ch-1", 2, "Calm", 3),
      page("ch-2", "Two"),
      heading("ch-2", 2, "Storm", 2),
    ];
    const f = files(book(), items);
    const list = text(f, "OEBPS/toc.xhtml");
    // page > H1 > H2 > H3, with the second H2 a sibling of the first
    expect(list).toContain(
      '<ol role="list"><li><a href="ch-1.xhtml">One</a><ol role="list"><li><a href="ch-1.xhtml#h-0">One</a><ol role="list"><li><a href="ch-1.xhtml#h-1">Storm</a><ol role="list"><li><a href="ch-1.xhtml#h-2">Deep</a></li></ol></li><li><a href="ch-1.xhtml#h-3">Calm</a></li></ol></li></ol></li><li><a href="ch-2.xhtml">Two</a><ol role="list"><li><a href="ch-2.xhtml#h-2">Storm</a></li></ol></li></ol>',
    );
    expect(navList(f)).toContain('<a href="ch-2.xhtml#h-2">Storm</a>');
    // The anchors exist in the chapter files, counting the empty heading in chapter two.
    expect(text(f, "OEBPS/ch-1.xhtml")).toContain('<h2 id="h-3">Calm</h2>');
    expect(text(f, "OEBPS/ch-2.xhtml")).toContain('<h2 id="h-1"></h2>\n<h2 id="h-2">Storm</h2>');
  });

  it("nests a part's chapters and their headings by indent", () => {
    const chapters: EpubChapter[] = [
      { id: "pt-1", title: "Part One", kind: "part", doc: doc(h(1, "Part One")) },
      ...book(),
    ];
    const items: ContentsItem[] = [
      page("pt-1", "Part One"),
      { ...page("ch-1", "One"), indent: 1 },
      { ...heading("ch-1", 1, "One", 0), indent: 2 },
      { ...heading("ch-1", 2, "Storm", 1), indent: 3 },
    ];
    const f = files(chapters, items);
    expect(text(f, "OEBPS/toc.xhtml")).toContain(
      '<ol role="list"><li><a href="pt-1.xhtml">Part One</a><ol role="list"><li><a href="ch-1.xhtml">One</a><ol role="list"><li><a href="ch-1.xhtml#h-0">One</a><ol role="list"><li><a href="ch-1.xhtml#h-1">Storm</a></li></ol></li></ol></li></ol></li></ol>',
    );
    expect(navList(f)).toContain(
      '<a href="pt-1.xhtml">Part One</a><ol><li><a href="ch-1.xhtml">One</a>',
    );
  });

  it("does not add heading ids when no contents are given", () => {
    const f = files(book());
    expect(text(f, "OEBPS/ch-1.xhtml")).not.toContain(' id="h-');
    // no list on the contents page and the navigation is the old flat list (the contents page is listed, unlisted kinds are not)
    expect(text(f, "OEBPS/toc.xhtml")).not.toContain("<nav");
    expect(navList(f)).toContain('<a href="toc.xhtml">Contents</a>');
    expect(navList(f)).not.toContain("fm-1.xhtml");
  });

  it("keeps the nested list flat when only pages are listed, and a level jump nests directly", () => {
    const f = files(book(), [
      heading("ch-1", 3, "Deep", 2),
      page("ch-1", "One"),
      heading("ch-1", 2, "Storm", 1),
    ]);
    expect(navList(f)).toContain(
      '<ol><li><a href="ch-1.xhtml#h-2">Deep</a></li><li><a href="ch-1.xhtml">One</a><ol><li><a href="ch-1.xhtml#h-1">Storm</a></li></ol></li></ol>',
    );
  });

  it("applies renames, hidden, order and custom entries as given", () => {
    const items: ContentsItem[] = [
      page("bm-1", "Acknowledgements (renamed)"),
      { kind: "custom", level: 0, title: "Map of the Quay", entryId: "ch-1" },
      page("ch-2", "Two"),
      { kind: "custom", level: 0, title: "Unlinked note" },
      { ...page("ch-1", "One"), hidden: true },
    ];
    const f = files(book(), items);
    expect(navList(f)).toBe(
      '<h1>Contents</h1><ol><li><a href="bm-1.xhtml">Acknowledgements (renamed)</a></li><li><a href="ch-1.xhtml">Map of the Quay</a></li><li><a href="ch-2.xhtml">Two</a></li></ol>',
    );
    // The contents page lists the same entries, plus the one that links nowhere as plain text.
    expect(text(f, "OEBPS/toc.xhtml")).toContain(
      '<ol role="list"><li><a href="bm-1.xhtml">Acknowledgements (renamed)</a></li><li><a href="ch-1.xhtml">Map of the Quay</a></li><li><a href="ch-2.xhtml">Two</a></li><li><span>Unlinked note</span></li></ol>',
    );
    expect(text(f, "OEBPS/toc.xhtml")).not.toContain('href="ch-1.xhtml">One<');
  });

  it("links a custom entry to the heading its target points at, else to the page", () => {
    const items: ContentsItem[] = [
      { kind: "custom", level: 0, title: "Calm", entryId: "ch-1", targetIndex: 3 },
      { kind: "custom", level: 0, title: "Top", entryId: "ch-1" },
    ];
    const f = files(book(), items);
    expect(navList(f)).toContain(
      '<li><a href="ch-1.xhtml#h-3">Calm</a></li><li><a href="ch-1.xhtml">Top</a></li>',
    );
    expect(text(f, "OEBPS/ch-1.xhtml")).toContain('id="h-3"');
  });

  it("never writes an empty link or span: a blank title becomes the entry id", () => {
    const items: ContentsItem[] = [
      { ...page("ch-1", "  ") },
      { kind: "custom", level: 0, title: "", entryId: "nowhere" },
      { kind: "custom", level: 0, title: "" },
    ];
    const f = files(book(), items);
    expect(navList(f)).toContain('<a href="ch-1.xhtml">ch-1</a>');
    const inBook = text(f, "OEBPS/toc.xhtml");
    expect(inBook).toContain("<span>nowhere</span>");
    expect(inBook).toContain("<span>(untitled)</span>");
    expect(inBook).not.toMatch(/<a [^>]*><\/a>|<span><\/span>/);
  });

  it("leaves entries that point at a page that is not in the book unlinked (stale overrides ignored)", () => {
    const f = files(book(), [page("gone", "Removed chapter"), page("ch-1", "One")]);
    expect(text(f, "OEBPS/toc.xhtml")).toContain("<li><span>Removed chapter</span></li>");
    expect(navList(f)).not.toContain("Removed chapter");
    expect(navList(f)).toContain('<a href="ch-1.xhtml">One</a>');
  });

  it("escapes special characters in titles", () => {
    const f = files(book(), [page("ch-1", `A & B <i> "q" 'a' ]]> ${"שלום"}`)]);
    const want = "A &amp; B &lt;i&gt; &quot;q&quot; 'a' ]]&gt; שלום";
    expect(text(f, "OEBPS/toc.xhtml")).toContain(`>${want}</a>`);
    expect(navList(f)).toContain(`>${want}</a>`);
  });

  it("refuses a title XML cannot hold", () => {
    expect(() => files(book(), [page("ch-1", "bad\u0001title")])).toThrow(EpubExportError);
  });

  it("falls back to the plain navigation when every entry is hidden or the list is empty", () => {
    for (const items of [[], [{ ...page("ch-1", "One"), hidden: true }]]) {
      const f = files(book(), items);
      expect(navList(f)).toContain('<a href="ch-1.xhtml">One</a>');
      expect(text(f, "OEBPS/toc.xhtml")).not.toContain("<nav");
    }
  });

  it("adds a translated heading when the contents page has none", () => {
    const empty = book().map((c) => (c.id === "toc" ? { ...c, doc: doc(p("intro")) } : c));
    const titles: Record<string, string> = {
      en: "Contents",
      he: "תוכן העניינים",
      ar: "المحتويات",
      it: "Indice",
      ja: "目次",
      ru: "Содержание",
      fr: "Table des matières",
      de: "Inhaltsverzeichnis",
      es: "Índice",
    };
    for (const [lang, title] of Object.entries(titles)) {
      const f = files(empty, chapters0, lang);
      const xhtml = text(f, "OEBPS/toc.xhtml");
      expect(xhtml).toContain(
        `<h1 id="contents-title">${title}</h1><p>intro</p><nav epub:type="toc" role="doc-toc" class="contents" aria-labelledby="contents-title">`,
      );
      expect(xhtml).toContain(`lang="${lang}"`);
      expect(xhtml).toContain(lang === "he" || lang === "ar" ? ' dir="rtl"' : "<body");
      expect(navList(f)).toContain(`<h1>${title}</h1>`);
    }
    expect(() => files(empty, chapters0, "xx")).toThrow(/no "Contents" translation/);
  });

  it("writes RTL books with right-to-left page progression and the list intact", () => {
    const f = files(book(), [page("ch-1", "פרק א"), heading("ch-1", 2, "عنوان", 1)], "ar");
    expect(text(f, "OEBPS/content.opf")).toContain('page-progression-direction="rtl"');
    expect(text(f, "OEBPS/toc.xhtml")).toContain("פרק א");
    expect(navList(f)).toContain('href="ch-1.xhtml#h-1">عنوان');
  });

  it("works with a book that has a contents page and the unlisted kinds, for the same kinds the resolver leaves out", () => {
    const f = files(matterBook(), [page("ch-1", "Chapter One")]);
    for (const c of matterBook())
      if (c.kind && c.kind !== "part" && TOC_UNLISTED_KINDS.includes(c.kind))
        expect(navList(f)).not.toContain(`${c.id}.xhtml`);
  });

  it("still refuses unknown nodes on every page, the contents page included", () => {
    const bad = book().map((c) =>
      c.id === "toc" ? { ...c, doc: doc({ type: "mystery" } as unknown as DocNode) } : c,
    );
    expect(() => files(bad, chapters0)).toThrow(/Unsupported node type in chapter: mystery/);
    expect(() => files(bad)).toThrow(EpubExportError);
  });

  it("keeps the nav unchanged for a book without a contents page when contents are given", () => {
    const f = files(matterBook(), [page("ch-1", "Chapter One"), page("ch-2", "Chapter Two")]);
    expect(navList(f)).toBe(
      '<h1>Contents</h1><ol><li><a href="ch-1.xhtml">Chapter One</a></li><li><a href="ch-2.xhtml">Chapter Two</a></li></ol>',
    );
  });

  // EPUBCheck (RSC-005): in the navigation document a <span> is only allowed as the heading of a nested list.
  it("leaves an entry that links nowhere out of the navigation document and keeps it on the contents page", () => {
    const items: ContentsItem[] = [
      page("ch-1", "One"),
      { kind: "custom", level: 0, title: "A line pointing nowhere" },
      { kind: "custom", entryId: "gone", level: 0, title: "Points at a missing page" },
      page("ch-2", "Two"),
    ];
    const f = files(book(), items);
    expect(navList(f)).toBe(
      '<h1>Contents</h1><ol><li><a href="ch-1.xhtml">One</a></li><li><a href="ch-2.xhtml">Two</a></li></ol>',
    );
    const xhtml = text(f, "OEBPS/toc.xhtml");
    expect(xhtml).toContain("<li><span>A line pointing nowhere</span></li>");
    expect(xhtml).toContain("<li><span>Points at a missing page</span></li>");
  });

  it("keeps an unlinked entry in the navigation document when linked entries are nested under it", () => {
    const items: ContentsItem[] = [
      { kind: "custom", level: 0, title: "Part One" },
      { ...page("ch-1", "One"), level: 1 },
      { ...page("ch-2", "Two"), level: 1 },
    ];
    expect(navList(files(book(), items))).toBe(
      '<h1>Contents</h1><ol><li><span>Part One</span><ol><li><a href="ch-1.xhtml">One</a></li><li><a href="ch-2.xhtml">Two</a></li></ol></li></ol>',
    );
  });

  it("drops an unlinked parent whose children are all unlinked, and lists the chapters when nothing is left", () => {
    const items: ContentsItem[] = [
      { kind: "custom", level: 0, title: "Part One" },
      { kind: "custom", level: 1, title: "Nowhere" },
    ];
    const f = files(book(), items);
    expect(navList(f)).toBe(
      '<h1>Contents</h1><ol><li><a href="toc.xhtml">Contents</a></li><li><a href="ch-1.xhtml">One</a></li><li><a href="ch-2.xhtml">Two</a></li><li><a href="bm-1.xhtml">Thanks</a></li></ol>',
    );
    expect(text(f, "OEBPS/toc.xhtml")).toContain(
      '<li><span>Part One</span><ol role="list"><li><span>Nowhere</span></li></ol></li>',
    );
  });

  it("makes the contents page a named doc-toc landmark with real links, unique heading ids and the language", () => {
    const f = files(book(), [
      page("ch-1", "One"),
      heading("ch-1", 2, "Storm", 1),
      page("ch-2", "Two"),
      { kind: "custom", level: 0, title: "Unlinked note" },
    ]);
    const xhtml = text(f, "OEBPS/toc.xhtml");
    expect(xhtml).toContain('lang="en" xml:lang="en"');
    expect(xhtml.match(/<nav /g)).toHaveLength(1);
    const navHtml = /<nav [^>]*>.*<\/nav>/s.exec(xhtml)![0];
    // named by the page's own heading (aria-label is not used), and the heading exists
    expect(navHtml).toContain('epub:type="toc" role="doc-toc"');
    expect(navHtml).toContain('aria-labelledby="h-0"');
    expect(navHtml).not.toContain("aria-label=");
    expect(xhtml).toContain('<h1 id="h-0">Contents</h1>');
    // an ordered list (role kept: the stylesheet removes the markers), links with text and no empty link, no leaders or numbers
    expect(navHtml).toContain('<ol role="list">');
    for (const m of navHtml.matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g))
      expect(m[2]!.trim()).not.toBe("");
    expect(navHtml).not.toMatch(/<a [^>]*><\/a>|<span><\/span>/);
    expect(navHtml).not.toMatch(/aria-hidden|\.\.\.|leader/);
    // every anchor the list links to exists once, and ids are unique in each page
    for (const [, file, id] of navHtml.matchAll(/href="([^"#]+)\.xhtml#([^"]+)"/g)) {
      expect(text(f, `OEBPS/${file}.xhtml`).match(new RegExp(` id="${id}"`, "g"))).toHaveLength(1);
    }
    for (const name of ["toc", "ch-1", "ch-2"]) {
      const ids = [...text(f, `OEBPS/${name}.xhtml`).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // the navigation document stays the only page with the main toc nav; it has no duplicate of the page's labelling
    expect(nav(f).match(/<nav epub:type="toc"/g)).toHaveLength(1);
    expect(nav(f)).not.toContain("aria-labelledby");
  });

  it("names the nav by a generated heading when the contents page has none of its own", () => {
    const empty = book().map((c) => (c.id === "toc" ? { ...c, doc: doc(p("intro")) } : c));
    const xhtml = text(files(empty, chapters0), "OEBPS/toc.xhtml");
    expect(xhtml).toContain('<h1 id="contents-title">Contents</h1>');
    expect(xhtml).toContain('aria-labelledby="contents-title"');
  });
});

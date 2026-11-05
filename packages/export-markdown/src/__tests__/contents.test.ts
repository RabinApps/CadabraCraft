import { describe, expect, it } from "vitest";
import { headingTexts, slugger } from "../contents";
import { importMarkdown } from "@cadabracraft/import-docx";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import {
  MarkdownExportError,
  bookToMarkdown,
  chaptersToMarkdown,
  type MarkdownChapter,
  type MarkdownContentsItem,
} from "../index";

const h = (level: number, text: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: text === "" ? [] : [{ type: "text", text }],
});
const p = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const book = { title: "B" };

const pages = (): MarkdownChapter[] => [
  {
    id: "ch-1",
    title: "One",
    doc: doc(h(1, "One"), p("x"), h(2, "Storm"), h(3, "Deep"), h(2, "Storm")),
  },
  { id: "toc", title: "Contents", doc: doc(h(1, "Contents")), section: "front", kind: "contents" },
  { id: "ch-2", title: "Two", doc: doc(p("no heading"), h(2, ""), h(2, "Storm")) },
  { id: "bm", title: "Thanks", doc: doc(p("t")), section: "back", kind: "acknowledgments" },
];
const page = (entryId: string, title: string): MarkdownContentsItem => ({
  kind: "page",
  entryId,
  level: 0,
  title,
});
const head = (
  entryId: string,
  level: number,
  title: string,
  index: number,
): MarkdownContentsItem => ({
  kind: "heading",
  entryId,
  level,
  title,
  index,
});

const tocOf = (md: string[]) => md[0]!;

describe("Markdown contents page", () => {
  it("writes a nested list linking to chapter anchors in the single document", () => {
    const items = [
      page("ch-1", "One"),
      head("ch-1", 1, "One", 0),
      head("ch-1", 2, "Storm", 1),
      head("ch-1", 3, "Deep", 2),
      head("ch-1", 2, "Storm", 3),
      page("ch-2", "Two"),
      head("ch-2", 2, "Storm", 1),
      page("bm", "Thanks"),
    ];
    const md = bookToMarkdown(book, pages(), {}, { items });
    // Reading order: contents (front) first. Anchors are unique over the whole document.
    expect(md.startsWith("# Contents\n\n- [One](#one)\n  - [One](#one)")).toBe(true);
    expect(md).toContain(
      "  - [One](#one)\n    - [Storm](#storm)\n      - [Deep](#deep)\n    - [Storm](#storm-1)\n",
    );
    expect(md).toContain("- [Two](#two)\n  - [Storm](#storm-2)\n- [Thanks](#thanks)\n");
    // The heading anchors really exist in the document (the title of a page without one is added as `# Two`).
    expect(md).toContain("\n# Two\n");
    expect(md).toContain("\n## Storm\n");
    // The output still imports; the importer only keeps http, https and mailto links, so in-book links are reported and dropped.
    const codes = new Set(importMarkdown(md).warnings.map((w) => w.code));
    expect([...codes].filter((c) => c !== "unsafe-link" && c !== "no-headings")).toEqual([]);
  });

  it("links to files when each page is written to its own file", () => {
    const files = { "ch-1": "01 one.md", toc: "00-contents.md", "ch-2": "02-two.md" };
    const out = chaptersToMarkdown(
      book,
      pages(),
      {},
      {
        items: [
          page("ch-1", "One"),
          head("ch-1", 2, "Storm", 1),
          head("ch-1", 2, "Storm", 3),
          page("ch-2", "Two"),
          head("ch-2", 2, "Storm", 1),
          page("bm", "Thanks"),
        ],
        files,
      },
    );
    expect(tocOf(out)).toBe(
      "# Contents\n\n- [One](01%20one.md#one)\n  - [Storm](01%20one.md#storm)\n  - [Storm](01%20one.md#storm-1)\n- [Two](02-two.md#two)\n  - [Storm](02-two.md#storm)\n- Thanks\n",
    );
  });

  it("nests a part's chapters and their headings by indent", () => {
    const chapters: MarkdownChapter[] = [
      { id: "pt-1", title: "Part One", doc: doc(h(1, "Part One")) },
      ...pages(),
    ];
    const items: MarkdownContentsItem[] = [
      page("pt-1", "Part One"),
      { ...page("ch-1", "One"), indent: 1 },
      { ...head("ch-1", 1, "One", 0), indent: 2 },
    ];
    expect(tocOf(chaptersToMarkdown(book, chapters, {}, { items }))).toBe(
      "# Contents\n\n- [Part One](#part-one)\n  - [One](#one)\n    - [One](#one)\n",
    );
  });

  it("applies hidden, renamed, reordered and custom entries as given, stale ones ignored", () => {
    const items: MarkdownContentsItem[] = [
      { ...page("ch-2", "Zwei"), hidden: true },
      { kind: "custom", level: 0, title: "Map [of] the *Quay*", entryId: "ch-1" },
      page("bm", "Thanks (renamed)"),
      page("gone", "Removed"),
      { kind: "custom", level: 0, title: "# Not a heading" },
      { kind: "heading", entryId: "ch-1", level: 1, title: "no index" },
    ];
    const out = tocOf(chaptersToMarkdown(book, pages(), {}, { items }));
    expect(out).toBe(
      "# Contents\n\n- [Map \\[of\\] the \\*Quay\\*](#one)\n- [Thanks (renamed)](#thanks)\n- Removed\n- \\# Not a heading\n  - [no index](#one)\n",
    );
  });

  it("links a custom entry to the heading its target points at, in one document and in files", () => {
    const items: MarkdownContentsItem[] = [
      { kind: "custom", level: 0, title: "Again", entryId: "ch-1", targetIndex: 3 },
      { kind: "custom", level: 0, title: "Top", entryId: "ch-1" },
    ];
    expect(tocOf(chaptersToMarkdown(book, pages(), {}, { items }))).toBe(
      "# Contents\n\n- [Again](#storm-1)\n- [Top](#one)\n",
    );
    const files = { toc: "0.md", "ch-1": "1.md", "ch-2": "2.md", bm: "3.md" };
    expect(tocOf(chaptersToMarkdown(book, pages(), {}, { items, files }))).toBe(
      "# Contents\n\n- [Again](1.md#storm-1)\n- [Top](1.md#one)\n",
    );
  });

  it("never writes an empty label: a blank title becomes the entry id", () => {
    const items: MarkdownContentsItem[] = [
      { kind: "page", level: 0, title: " ", entryId: "ch-1" },
      { kind: "custom", level: 0, title: "" },
    ];
    expect(tocOf(chaptersToMarkdown(book, pages(), {}, { items }))).toBe(
      "# Contents\n\n- [ch-1](#one)\n- (untitled)\n",
    );
  });

  it("slugs special characters and other languages like GitHub does", () => {
    const chapters: MarkdownChapter[] = [
      { id: "toc", title: "Inhalt", doc: doc(h(1, "Inhalt")), kind: "contents", section: "front" },
      { id: "a", title: "Café: A & B?", doc: doc(h(1, "Café: A & B?")) },
      { id: "b", title: "פרק א", doc: doc(h(1, "פרק א")) },
      { id: "c", title: "فصل", doc: doc(h(1, "فصل _x_")) },
      { id: "d", title: "!!!", doc: doc(h(1, "!!!")) },
      { id: "e", title: "第一章", doc: doc(h(1, "第一章")) },
    ];
    const items = chapters.slice(1).map((c) => page(c.id!, c.title));
    const out = tocOf(chaptersToMarkdown(book, chapters, {}, { items }));
    expect(out).toContain("- [Café: A & B?](#café-a--b)\n");
    expect(out).toContain("- [פרק א](#פרק-א)\n");
    expect(out).toContain("(#فصل-_x_)");
    // a heading with no usable anchor is listed without a link
    expect(out).toContain("- !!!\n");
    expect(out).toContain("(#第一章)");
  });

  it("writes nothing for an empty or fully hidden list, and nothing without contents", () => {
    const hidden = [{ ...page("ch-1", "One"), hidden: true }];
    for (const items of [[], hidden])
      expect(tocOf(chaptersToMarkdown(book, pages(), {}, { items }))).toBe("# Contents\n");
    const plain = chaptersToMarkdown(book, pages());
    expect(tocOf(plain)).toBe("# Contents\n");
    expect(chaptersToMarkdown(book, pages(), {}, undefined)).toEqual(plain);
  });

  it("only changes the page of kind contents, and handles a contents page with no content", () => {
    const withList = chaptersToMarkdown(book, pages(), {}, { items: [page("ch-1", "One")] });
    const without = chaptersToMarkdown(book, pages());
    expect(withList.slice(1)).toEqual(without.slice(1));
    const empty = chaptersToMarkdown(
      book,
      [
        { id: "toc", title: "", doc: doc(), kind: "contents", section: "front" },
        { id: "a", title: "A", doc: doc(h(1, "A")) },
      ],
      {},
      { items: [page("a", "A")] },
    );
    expect(empty[0]).toBe("- [A](#a)\n");
  });

  it("allocates anchors for pages without an id too", () => {
    const chapters: MarkdownChapter[] = [
      { title: "Same", doc: doc(h(1, "Same")) },
      { id: "toc", title: "C", doc: doc(h(1, "C")), kind: "contents", section: "front" },
      { id: "x", title: "Same", doc: doc(h(1, "Same")) },
    ];
    const out = tocOf(chaptersToMarkdown(book, chapters, {}, { items: [page("x", "Same")] }));
    expect(out).toBe("# C\n\n- [Same](#same-1)\n");
  });

  it("refuses unknown nodes everywhere, the contents page included", () => {
    const bad = pages().map((c) =>
      c.id === "toc" ? { ...c, doc: doc({ type: "mystery" } as unknown as DocNode) } : c,
    );
    expect(() => chaptersToMarkdown(book, bad, {}, { items: [] })).toThrow(MarkdownExportError);
    expect(() => chaptersToMarkdown(book, bad)).toThrow(/mystery/);
  });

  it("handles marked text in headings, shared files, pages without a file, empty anchors and stale heading indexes", () => {
    const chapters: MarkdownChapter[] = [
      { id: "toc", title: "C", doc: doc(h(1, "C")), kind: "contents", section: "front" },
      {
        id: "a",
        title: "A",
        doc: doc({
          type: "heading",
          attrs: { level: 1 },
          content: [
            { type: "text", text: "Line " },
            { type: "text", text: "two", marks: [{ type: "bold" }] },
          ],
        }),
      },
      { id: "b", title: "B", doc: doc(h(1, "!!!")) },
      { id: "c", title: "C2", doc: doc(h(1, "C2")) },
    ];
    const out = tocOf(
      chaptersToMarkdown(
        book,
        chapters,
        {},
        {
          items: [
            page("a", "A"),
            page("b", "B"),
            page("c", "C2"),
            head("a", 2, "stale", 9),
            { kind: "custom", level: 0, title: "free" },
          ],
          files: { toc: "all.md", a: "all.md", b: "all.md" },
        },
      ),
    );
    // a and b share a file (anchors unique inside it); b has no usable anchor so the link is the file; c has no file
    expect(out).toBe(
      "# C\n\n- [A](all.md#line-two)\n- [B](all.md)\n- C2\n  - [stale](all.md)\n- free\n",
    );
  });

  it("reads heading texts from nested nodes and dedupes slugs", () => {
    const d = doc(
      { type: "blockquote", content: [h(2, "In quote")] },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "hardBreak" }, { type: "text", text: "x" }],
      },
    );
    expect(headingTexts(d)).toEqual(["In quote", "x"]);
    const slug = slugger();
    expect([slug("A b"), slug("a B"), slug("a b")]).toEqual(["a-b", "a-b-1", "a-b-2"]);
  });

  it("is a real list of links with a text label each, no page numbers or leaders, after front matter with the language", () => {
    const items = [page("ch-1", "One"), head("ch-1", 2, "Storm", 1), page("ch-2", "Two")];
    const md = bookToMarkdown(
      { ...book, language: "fr" },
      pages(),
      { frontMatter: true },
      { items },
    );
    expect(md.startsWith('---\ntitle: "B"\nlang: "fr"\n---\n\n# Contents\n\n- [One]')).toBe(true);
    const list = md.slice(md.indexOf("- [One]"), md.indexOf("\n\n", md.indexOf("- [One]")));
    const rows = list.split("\n");
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatch(/^ *- \[[^\]]+\]\(#[^)]+\)$/);
    expect(list).not.toMatch(/\.{3}|\t|\d+$/);
  });
});

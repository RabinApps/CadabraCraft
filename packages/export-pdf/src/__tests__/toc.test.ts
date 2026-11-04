import { describe, expect, it } from "vitest";
import { PdfExportError } from "../errors";
import { buildTypst } from "../typst";
import { tocEntries, tocHeadingKeys } from "../typst/toc";
import { tocBook, itemsAtDepth } from "./tocBook";

const { book, pages, items } = tocBook({
  chapters: 2,
  headings: [
    [2, "The Storm"],
    [2, "The Storm"],
  ],
  foreword: true,
});
const build = (toc = { items }, extra = {}) => buildTypst(book, pages, { toc, ...extra });

describe("Contents page source", () => {
  const src = build();
  it("starts on a right-hand page, without folio, through the matter layout", () => {
    expect(src).toContain(
      '#pagebreak(weak: true, to: "odd")\n\n#contents-page("toc", "contents", (\n',
    );
    const page = /#contents-page\("toc", "contents", [\s\S]*?\n\]\n/.exec(src)![0];
    expect(page).toContain("Contents");
    expect(src).toContain('matter-marks(id, kind, "folio-off-start", "folio-off-end"');
  });
  it("lists every visible item with key, level, title and target", () => {
    expect(src).toContain('(key: "fw", level: 0, title: "Foreword", target: "fw"),');
    expect(src).toContain(
      '(key: "ch-1#2:the storm:1", level: 2, title: "The Storm", target: "ch-1#2:the storm:1"),',
    );
  });
  it("defines the list with leaders and numbers formatted like the footer", () => {
    expect(src).toContain("query(<toc-heading>)");
    expect(src).toContain("repeat(gap: 0.3em)[.]");
    expect(src).toContain('{ "i" } else { "1" }');
    expect(src).toContain("#let toc-numbers = true");
    expect(src).toContain("counter(page).at(loc)");
  });
  it("marks the headings of the items, by outline position, and nothing else", () => {
    const marks = [...src.matchAll(/#mark\("toc-heading", info: \(key: ("[^"]+")\)\)/g)].map(
      (m) => m[1],
    );
    expect(marks).toEqual([
      '"ch-1#1:chapter 1:0"',
      '"ch-1#2:the storm:0"',
      '"ch-1#2:the storm:1"',
      '"ch-2#1:chapter 2:0"',
      '"ch-2#2:the storm:0"',
      '"ch-2#2:the storm:1"',
    ]);
    // inside the heading of the chapter: the mark is part of the heading's content
    expect(src).toMatch(
      /#heading\(level: 2\)\[#mark\("toc-heading", info: \(key: "ch-1#2:the storm:0"\)\)The Storm\]/,
    );
  });
  it("emits no heading marks at depth 0 and none for headings not in the list", () => {
    const flat = build({ items: itemsAtDepth(items, 0) });
    expect(flat).not.toContain('toc-heading", info');
    expect(flat).toContain("#contents-page(");
    const some = build({ items: itemsAtDepth(items, 1) });
    expect(some.match(/#mark\("toc-heading", info/g)).toHaveLength(2);
  });
  it("skips hidden items in the list but keeps marks for them", () => {
    const hid = items.map((i) => (i.key === "ch-1#2:the storm:0" ? { ...i, hidden: true } : i));
    const s = build({ items: hid });
    expect(s).not.toContain('(key: "ch-1#2:the storm:0", level');
    expect(s).toContain('#mark("toc-heading", info: (key: "ch-1#2:the storm:0"))');
  });
  it("custom entries use their target, or none", () => {
    const s = build({
      items: [
        { key: "custom:a", kind: "custom", level: 0, title: "Map", target: "ch-2" },
        { key: "custom:b", kind: "custom", level: 1, title: "Plain" },
      ],
    });
    expect(s).toContain('(key: "custom:a", level: 0, title: "Map", target: "ch-2"),');
    expect(s).toContain('(key: "custom:b", level: 1, title: "Plain", target: none),');
  });
  it("leaves numbers and leaders out when switched off, in the toc or in the document", () => {
    expect(build({ items, pageNumbers: false } as never)).toContain("#let toc-numbers = false");
    expect(buildTypst(book, pages, { toc: { items }, pageNumbers: false })).toContain(
      "#let toc-numbers = false",
    );
  });
  it("writes an empty list when there are no items, and only the page when there is no toc option", () => {
    expect(build({ items: [] })).toContain('#contents-page("toc", "contents", ())');
    const none = buildTypst(book, pages);
    expect(none).toContain('#contents-page("toc", "contents", ())');
    expect(none).not.toContain('toc-heading", info');
  });
  it("is not written for books without a Contents page", () => {
    const plain = buildTypst(book, pages.slice(1), { toc: { items } });
    expect(plain).not.toContain("contents-page");
    expect(plain).not.toContain("toc-heading");
  });
  it("keeps the page report and start marks of the contents entry", () => {
    expect(src).toContain("query(<chapter-start>)");
    expect(src).toContain('mark("chapter-start", info: (id: id, kind: kind))');
  });
  it("counts headings from zero in every chapter, also inside quotes and lists", () => {
    const nested = {
      ...pages[2]!,
      doc: {
        type: "doc" as const,
        content: [
          {
            type: "blockquote" as const,
            content: [
              {
                type: "heading" as const,
                attrs: { level: 2 },
                content: [{ type: "text" as const, text: "In quote" }],
              },
            ],
          },
          {
            type: "heading" as const,
            attrs: { level: 1 },
            content: [{ type: "text" as const, text: "After" }],
          },
        ],
      },
    };
    const s = buildTypst(book, [pages[0]!, nested], {
      toc: {
        items: [
          { key: "k0", kind: "heading", level: 2, title: "In quote", entryId: nested.id, index: 0 },
          { key: "k1", kind: "heading", level: 1, title: "After", entryId: nested.id, index: 1 },
        ],
      },
    });
    expect(s).toContain('#heading(level: 2)[#mark("toc-heading", info: (key: "k0"))In quote]');
    expect(s).toContain('#heading(level: 1)[#mark("toc-heading", info: (key: "k1"))After]');
  });
});

describe("Contents page escaping", () => {
  const nasty = [
    "Hash # and $money$ @ref \\ back",
    'say "hi" <b> *x* _y_ `z`',
    "שלום עולם 日本語",
    "line\nbreak",
  ];
  const entries = nasty.map((title, i) => ({
    key: `ch-${i}`,
    kind: "page" as const,
    level: 0,
    title,
  }));
  const src = tocEntries(entries);
  it("writes titles as string literals", () => {
    expect(src).toContain('title: "Hash # and $money$ @ref \\\\ back"');
    expect(src).toContain('title: "say \\"hi\\" <b> *x* _y_ `z`"');
    expect(src).toContain('title: "שלום עולם 日本語"');
    expect(src).toContain('title: "line\\nbreak"');
  });
  it("escapes keys that carry user text", () => {
    const s = tocEntries([
      { key: 'ch#1:say "x" \\:0', kind: "heading", level: 1, title: "t", entryId: "c", index: 0 },
    ]);
    expect(s).toContain('key: "ch#1:say \\"x\\" \\\\:0"');
    const k = tocHeadingKeys([
      { key: 'a"b', kind: "heading", level: 1, title: "t", entryId: "c", index: 0 },
    ]);
    expect(k.get("c")!.get(0)).toBe('a"b');
  });
  it("rejects levels outside 0 to 3", () => {
    for (const level of [4, -1, 1.5, NaN])
      expect(() => tocEntries([{ key: "a", kind: "page", level, title: "t" }])).toThrow(
        PdfExportError,
      );
  });
  it("takes its entries from the shared contents lines: hidden dropped, a blank title falls back like the other exports", () => {
    const s = tocEntries([
      { key: "a", kind: "page", level: 0, title: "  ", entryId: "ch-1" },
      { key: "b", kind: "page", level: 0, title: "", entryId: " " },
      { key: "c", kind: "page", level: 0, title: "Gone", entryId: "c", hidden: true },
    ]);
    expect(s).toContain('title: "ch-1"');
    expect(s).toContain('title: "(untitled)"');
    expect(s).not.toContain("Gone");
  });
  it("ignores heading items without entry or position, groups the rest by entry", () => {
    const m = tocHeadingKeys([
      { key: "a", kind: "heading", level: 1, title: "t" },
      { key: "b", kind: "heading", level: 1, title: "t", entryId: "c" },
      { key: "c1", kind: "heading", level: 1, title: "t", entryId: "c", index: 0 },
      { key: "c2", kind: "heading", level: 2, title: "t", entryId: "c", index: 3 },
      { key: "p", kind: "page", level: 0, title: "t", entryId: "c" },
    ]);
    expect([...m.keys()]).toEqual(["c"]);
    expect([...m.get("c")!]).toEqual([
      [0, "c1"],
      [3, "c2"],
    ]);
  });
});

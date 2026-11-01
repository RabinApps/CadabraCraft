import { unzipSync, strFromU8 } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { DocxExportError, buildDocx, type DocxChapter, type DocxContentsItem } from "../index";

const h1 = (text: string): DocNode => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const p = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const book = { title: "The Long Road", author: "Ada Lovelace" };

const toc = (over: Partial<DocxChapter> = {}): DocxChapter => ({
  id: "toc",
  title: "Contents",
  doc: doc(h1("Contents")),
  section: "front",
  kind: "contents",
  ...over,
});
const pages = (...extra: DocxChapter[]): DocxChapter[] => [
  toc(),
  { id: "ch-1", title: "One", doc: doc(h1("One"), p("alpha")) },
  { id: "ch-2", title: "Two", doc: doc(h1("Two"), p("beta")) },
  ...extra,
];

const item = (level: number, title: string, hidden?: boolean): DocxContentsItem => ({
  level,
  title,
  ...(hidden === undefined ? {} : { hidden }),
});

const xml = (
  chapters: DocxChapter[],
  contents?: readonly DocxContentsItem[],
  language?: string,
) => {
  const out = buildDocx(
    { ...book, ...(language ? { language } : {}) },
    chapters,
    contents === undefined ? {} : { contents },
  );
  const text = strFromU8(unzipSync(out)["word/document.xml"]!);
  expect(XMLValidator.validate(text)).toBe(true);
  return text;
};
/** Paragraph text and left indent of every paragraph. */
const lines = (document: string): { text: string; left: number }[] =>
  [...document.matchAll(/<w:p>(.*?)<\/w:p>/gs)].map((m) => ({
    text: [...m[1]!.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
    left: Number(/<w:ind[^>]*w:left="(\d+)"/.exec(m[1]!)?.[1] ?? 0),
  }));
const after = (document: string, title: string) => {
  const all = lines(document);
  const i = all.findIndex((l) => l.text === title);
  return all.slice(i + 1);
};

describe("DOCX contents page", () => {
  it("writes a static list after the page's heading, indented by level, with no numbers", () => {
    const d = xml(pages(), [
      item(0, "One"),
      item(1, "Storm"),
      item(2, "Deep"),
      item(3, "Deeper"),
      item(0, "Two"),
    ]);
    expect(after(d, "Contents").slice(0, 5)).toEqual([
      { text: "One", left: 0 },
      { text: "Storm", left: 720 },
      { text: "Deep", left: 1440 },
      { text: "Deeper", left: 2160 },
      { text: "Two", left: 0 },
    ]);
    expect(d).not.toMatch(/PAGEREF|TOC \\|<w:fldChar/);
    // the list stays on the contents page: the next page starts with a page break and its heading
    const next = d.indexOf("alpha");
    expect(d.lastIndexOf("<w:pageBreakBefore/>", next)).toBeGreaterThan(d.indexOf("Deeper"));
  });

  it("keeps the page's position in the reading order", () => {
    const d = xml(
      [
        { id: "ch-1", title: "One", doc: doc(h1("One")) },
        toc({ section: "front" }),
        { id: "bm", title: "Thanks", doc: doc(h1("Thanks")), section: "back" },
      ],
      [item(0, "One")],
    );
    const t = lines(d).map((l) => l.text);
    expect(t.indexOf("Contents")).toBeLessThan(t.indexOf("One"));
  });

  it("skips hidden entries, writes an empty list as nothing, and handles duplicate titles", () => {
    const d = xml(pages(), [
      item(0, "One", true),
      item(0, "Same"),
      item(1, "Same"),
      item(0, "Same"),
    ]);
    expect(after(d, "Contents").slice(0, 3)).toEqual([
      { text: "Same", left: 0 },
      { text: "Same", left: 720 },
      { text: "Same", left: 0 },
    ]);
    const empty = lines(xml(pages(), []));
    expect(empty.find((l) => l.text === "Contents")).toBeDefined();
    expect(empty.slice(empty.findIndex((l) => l.text === "Contents") + 1)[0]!.text).toBe("One");
    expect(empty.filter((l) => l.text === "One")).toHaveLength(1);
  });

  it("escapes special characters and keeps non-Latin text", () => {
    const d = xml(pages(), [item(0, `A & B <i> "q" ${"\u00e9\u3042"}`), item(1, "  spaced  ")]);
    expect(d).toContain("A &amp; B &lt;i&gt; &quot;q&quot; \u00e9\u3042");
    expect(d).toContain('xml:space="preserve">  spaced  </w:t>');
  });

  it("refuses a title Word cannot hold", () => {
    expect(() => xml(pages(), [item(0, "bad\u0001")])).toThrow(DocxExportError);
  });

  it("gives a contents page without a heading one from its title (or 'Contents')", () => {
    const bare = [toc({ doc: doc(p("intro")) }), ...pages().slice(1)];
    const d = lines(xml(bare, [item(0, "One")])).map((l) => l.text);
    expect(d.slice(d.indexOf("Contents"))).toEqual([
      "Contents",
      "intro",
      "One",
      "One",
      "alpha",
      "Two",
      "beta",
    ]);
    const untitled = [toc({ title: " ", doc: doc(p("intro")) }), ...pages().slice(1)];
    expect(lines(xml(untitled, [item(0, "One")])).map((l) => l.text)).toContain("Contents");
    const named = [toc({ title: "Inhalt", doc: doc(p("intro")) }), ...pages().slice(1)];
    expect(lines(xml(named, [item(0, "One")])).map((l) => l.text)).toContain("Inhalt");
  });

  it("is unchanged without contents (the page is written like any other)", () => {
    const withPage = xml(pages());
    expect(after(withPage, "Contents")[0]!.text).toBe("One");
    const same = xml(pages(), undefined);
    expect(same).toBe(withPage);
    // a list is only written on a page of kind contents
    const other = xml([{ ...toc(), kind: "preface" }, ...pages().slice(1)], [item(0, "X")]);
    expect(other).not.toContain(">X<");
  });

  it("still refuses unknown nodes, in the contents page too", () => {
    const bad = toc({ doc: doc({ type: "mystery" } as unknown as DocNode) });
    expect(() => xml([bad, ...pages().slice(1)], [item(0, "One")])).toThrow(/mystery/);
  });

  it("refuses right-to-left languages as before, with or without a list", () => {
    for (const language of ["he", "ar"])
      expect(() => xml(pages(), [item(0, "\u05e4\u05e8\u05e7")], language)).toThrow(
        /Right-to-left/,
      );
  });

  it("writes other languages as given", () => {
    for (const language of ["fr", "de", "ja", "ru"]) {
      const d = xml(
        pages(),
        [item(0, "Cap\u00edtulo \u7b2c\u4e00\u7ae0 \u0413\u043b\u0430\u0432\u0430")],
        language,
      );
      expect(d).toContain("Cap\u00edtulo \u7b2c\u4e00\u7ae0 \u0413\u043b\u0430\u0432\u0430");
    }
  });
});

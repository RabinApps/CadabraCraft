import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { RtfExportError, buildRtf, type RtfChapter, type RtfContentsItem } from "../index";

const h1 = (text: string): DocNode => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const p = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const book = { title: "The Long Road", author: "Ada Lovelace" };

const toc = (over: Partial<RtfChapter> = {}): RtfChapter => ({
  id: "toc",
  title: "Contents",
  doc: doc(h1("Contents")),
  section: "front",
  kind: "contents",
  ...over,
});
const pages = (): RtfChapter[] => [
  toc(),
  { id: "ch-1", title: "One", doc: doc(h1("One"), p("alpha")) },
  { id: "ch-2", title: "Two", doc: doc(h1("Two"), p("beta")) },
];
const item = (level: number, title: string, hidden?: boolean): RtfContentsItem => ({
  level,
  title,
  ...(hidden === undefined ? {} : { hidden }),
});

const rtf = (chapters: RtfChapter[], contents?: readonly RtfContentsItem[], language?: string) =>
  buildRtf(
    { ...book, ...(language ? { language } : {}) },
    chapters,
    contents === undefined ? {} : { contents },
  );
/** Paragraph text and left indent, from the `\pard ... \par` groups. */
const paras = (out: string): { text: string; left: number }[] =>
  [...out.matchAll(/\{(\\pard\\plain[^ ]*) ([^\n]*?)\\par\}/g)].map((m) => ({
    text: m[2]!,
    left: Number(/\\li(\d+)/.exec(m[1]!)![1]),
  }));
const after = (out: string, title: string) => {
  const all = paras(out);
  return all.slice(all.findIndex((l) => l.text === title) + 1);
};

describe("RTF contents page", () => {
  it("writes a static list after the page's heading, indented by level, with no numbers", () => {
    const out = rtf(pages(), [
      item(0, "One"),
      item(1, "Storm"),
      item(2, "Deep"),
      item(3, "Deeper"),
      item(0, "Two"),
    ]);
    expect(after(out, "Contents").slice(0, 5)).toEqual([
      { text: "One", left: 0 },
      { text: "Storm", left: 720 },
      { text: "Deep", left: 1440 },
      { text: "Deeper", left: 2160 },
      { text: "Two", left: 0 },
    ]);
    expect(out).not.toMatch(/PAGEREF|\\\\tab/);
    // the next page starts on a new page
    const alpha = paras(out).findIndex((l) => l.text === "alpha");
    expect(out.slice(out.indexOf("Deeper"), out.indexOf("alpha"))).toContain("\\pagebb");
    expect(alpha).toBeGreaterThan(0);
  });

  it("skips hidden entries, an empty list writes nothing, duplicates are kept", () => {
    const out = rtf(pages(), [item(0, "One", true), item(0, "Same"), item(1, "Same")]);
    expect(after(out, "Contents").slice(0, 2)).toEqual([
      { text: "Same", left: 0 },
      { text: "Same", left: 720 },
    ]);
    expect(after(rtf(pages(), []), "Contents")[0]!.text).toBe("One");
  });

  it("escapes braces, backslashes and non-ASCII text", () => {
    const out = rtf(pages(), [item(0, "A {b} \\ c"), item(0, "\u00e9\u3042\u05e9")]);
    expect(out).toContain("A \\{b\\} \\\\ c");
    expect(out).toContain("\\u233?\\u12354?\\u1513?");
    expect([...out].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });

  it("refuses a title RTF cannot hold", () => {
    expect(() => rtf(pages(), [item(0, "bad\u0001")])).toThrow(RtfExportError);
  });

  it("gives a contents page without a heading one from its title (or 'Contents')", () => {
    const bare = [toc({ doc: doc(p("intro")) }), ...pages().slice(1)];
    const t = paras(rtf(bare, [item(0, "One")])).map((l) => l.text);
    expect(t.slice(t.indexOf("Contents"))).toEqual([
      "Contents",
      "intro",
      "One",
      "One",
      "alpha",
      "Two",
      "beta",
    ]);
    const untitled = [toc({ title: " ", doc: doc(p("intro")) }), ...pages().slice(1)];
    expect(paras(rtf(untitled, [item(0, "One")])).map((l) => l.text)).toContain("Contents");
  });

  it("is unchanged without contents, and only a page of kind contents gets the list", () => {
    expect(after(rtf(pages()), "Contents")[0]!.text).toBe("One");
    expect(rtf(pages(), undefined)).toBe(rtf(pages()));
    const other = rtf([{ ...toc(), kind: "preface" }, ...pages().slice(1)], [item(0, "X")]);
    expect(other).not.toContain(" X\\par");
  });

  it("still refuses unknown nodes, in the contents page too", () => {
    const bad = toc({ doc: doc({ type: "mystery" } as unknown as DocNode) });
    expect(() => rtf([bad, ...pages().slice(1)], [item(0, "One")])).toThrow(/mystery/);
  });

  it("refuses right-to-left languages as before, and writes the others", () => {
    for (const language of ["he", "ar"])
      expect(() => rtf(pages(), [item(0, "x")], language)).toThrow(/Right-to-left/);
    for (const language of ["fr", "ja", "ru", "de", "es", "it"])
      expect(rtf(pages(), [item(0, "\u0413\u043b\u0430\u0432\u0430")], language)).toContain(
        "\\u1043?\\u1083?",
      );
  });
});

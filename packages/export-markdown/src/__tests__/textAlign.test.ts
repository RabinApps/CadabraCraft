import { describe, expect, it } from "vitest";
import { assertChapterDoc } from "@cadabracraft/editor-schema";
import { importMarkdown } from "@cadabracraft/import-docx";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { MarkdownExportError, chapterToMarkdown } from "../index";

const p = (align: unknown, text: string): DocNode => ({
  type: "paragraph",
  ...(align === undefined ? {} : { attrs: { textAlign: align as string } }),
  content: [{ type: "text", text }],
});
const h = (level: number, align: unknown, text: string): DocNode => ({
  type: "heading",
  attrs: { level, ...(align === undefined ? {} : { textAlign: align as string }) },
  content: [{ type: "text", text }],
});
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const html = { htmlMarks: true };

describe("text alignment in Markdown", () => {
  it("wraps an aligned top-level paragraph or heading in a div with htmlMarks", () => {
    expect(chapterToMarkdown(doc(p("center", "Middle")), html)).toBe(
      '<div align="center">\n\nMiddle\n\n</div>\n',
    );
    expect(
      chapterToMarkdown(doc(p("start", "L"), p("end", "R"), p(undefined, "plain")), html),
    ).toBe('<div align="left">\n\nL\n\n</div>\n\n<div align="right">\n\nR\n\n</div>\n\nplain\n');
    expect(chapterToMarkdown(doc(h(2, "center", "Title")), html)).toBe(
      '<div align="center">\n\n## Title\n\n</div>\n',
    );
  });

  it("writes plain Markdown without htmlMarks (there is no syntax for it), and never throws for it", () => {
    expect(chapterToMarkdown(doc(p("center", "Middle"), h(1, "end", "T")))).toBe("Middle\n\n# T\n");
  });

  it("leaves paragraphs in quotes, lists, tables and definitions as plain text", () => {
    const out = chapterToMarkdown(
      doc(
        { type: "blockquote", content: [p("center", "quoted")] },
        { type: "bulletList", content: [{ type: "listItem", content: [p("end", "item")] }] },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableCell", content: [p("center", "cell")] }] },
          ],
        },
        {
          type: "definitionList",
          content: [
            { type: "definitionTerm", content: [{ type: "text", text: "term" }] },
            { type: "definitionDescription", content: [p("end", "meaning")] },
          ],
        },
      ),
      html,
    );
    expect(out).not.toContain("<div");
    expect(out).toContain("> quoted");
    expect(out).toContain("- item");
  });

  it("leaves an empty aligned paragraph out, like an empty one", () => {
    expect(
      chapterToMarkdown(
        doc({ type: "paragraph", attrs: { textAlign: "center" } }, p(null, "x")),
        html,
      ),
    ).toBe("x\n");
  });

  it("refuses any other value, wrapped or not", () => {
    for (const opts of [html, undefined]) {
      expect(() => chapterToMarkdown(doc(p("justify", "x")), opts)).toThrow(MarkdownExportError);
      expect(() => chapterToMarkdown(doc(h(1, "left", "x")), opts)).toThrow(
        /text alignment "left" is not allowed/,
      );
    }
  });

  it("is read back by the importer: the same document", () => {
    const d = doc(
      h(1, undefined, "Chapter"),
      p("center", "Middle *line*"),
      p(undefined, "plain"),
      p("end", "Right"),
      h(2, "center", "Sub"),
      p("start", "Left"),
    );
    const out = importMarkdown(chapterToMarkdown(d, html));
    expect(out.warnings.filter((w) => w.code !== "no-headings")).toEqual([]);
    const back = { type: "doc" as const, content: out.chapters.flatMap((c) => c.doc.content) };
    assertChapterDoc(back);
    const align = (n: DocNode) => ("attrs" in n ? (n.attrs?.textAlign ?? null) : null);
    expect(back.content.map(align)).toEqual([null, "center", null, "end", "center", "start"]);
    expect(back.content.map((n) => n.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
      "heading",
      "paragraph",
    ]);
  });
});

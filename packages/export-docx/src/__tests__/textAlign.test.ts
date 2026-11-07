import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import { DocxExportError, buildDocx } from "../index";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (align: unknown, text: string): DocNode => ({
  type: "paragraph",
  ...(align === undefined ? {} : { attrs: { textAlign: align as string } }),
  content: [t(text)],
});
const book = { title: "The Long Road", author: "Ada Lovelace" };
const build = (...content: DocNode[]): string =>
  strFromU8(
    unzipSync(buildDocx(book, [{ title: "A", doc: { type: "doc", content } }]))[
      "word/document.xml"
    ]!,
  );
/** The paragraph properties of the paragraph that holds `text`. */
const ppr = (xml: string, text: string): string => {
  const para = xml.split("<w:p>").find((s) => s.includes(`>${text}</w:t>`)) ?? "";
  return /^<w:pPr>.*?<\/w:pPr>/.exec(para)?.[0] ?? "";
};

describe("text alignment", () => {
  it("writes w:jc for an aligned paragraph, with no first-line indent, and nothing for the others", () => {
    const xml = build(
      p("center", "mid"),
      p("end", "right"),
      p("start", "left"),
      p(undefined, "plain"),
    );
    expect(ppr(xml, "mid")).toBe('<w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>');
    expect(ppr(xml, "right")).toBe('<w:pPr><w:ind w:firstLine="0"/><w:jc w:val="right"/></w:pPr>');
    expect(ppr(xml, "left")).toBe('<w:pPr><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr>');
    expect(ppr(xml, "plain")).toBe("");
  });

  it("overrides the heading style's centring", () => {
    // After a paragraph: a heading that opens a chapter is taken for its title.
    const xml = build(p(undefined, "lead"), {
      type: "heading",
      attrs: { level: 1, textAlign: "end" },
      content: [t("Head")],
    });
    expect(ppr(xml, "Head")).toBe(
      '<w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="right"/></w:pPr>',
    );
  });

  it("aligns paragraphs in quotes, lists, task items, definitions and table cells", () => {
    const xml = build(
      { type: "blockquote", content: [p("center", "quoted")] },
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [p("center", "first"), p("end", "second")] }],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [p("end", "todo"), p("center", "more")],
          },
        ],
      },
      {
        type: "definitionList",
        content: [
          { type: "definitionTerm", content: [t("term")] },
          { type: "definitionDescription", content: [p("end", "meaning"), p("center", "again")] },
        ],
      },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableCell", content: [p("center", "cell")] }] },
        ],
      },
    );
    for (const [text, jc] of [
      ["quoted", "center"],
      ["first", "center"],
      ["second", "right"],
      ["todo", "right"],
      ["more", "center"],
      ["meaning", "right"],
      ["again", "center"],
      ["cell", "center"],
    ] as const)
      expect(ppr(xml, text), text).toContain(`<w:jc w:val="${jc}"/>`);
  });

  it("refuses any other value", () => {
    for (const bad of ["justify", "left", 4]) {
      expect(() => build(p(bad, "x")), String(bad)).toThrow(DocxExportError);
      expect(() => build(p(bad, "x"))).toThrow(/text alignment .* is not allowed/);
    }
  });
});

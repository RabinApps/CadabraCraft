import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import { RtfExportError, buildRtf } from "../index";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (align: unknown, text: string): DocNode => ({
  type: "paragraph",
  ...(align === undefined ? {} : { attrs: { textAlign: align as string } }),
  content: [t(text)],
});
const book = { title: "The Long Road", author: "Ada Lovelace" };
const build = (...content: DocNode[]): string =>
  buildRtf(book, [{ title: "A", doc: { type: "doc", content } }]);
/** The paragraph-formatting words (up to the text) of the paragraph that holds `text`. */
const words = (rtf: string, text: string): string => {
  const at = rtf.indexOf(` ${text}`);
  return rtf.slice(rtf.lastIndexOf("\\pard", at), at);
};

describe("text alignment", () => {
  it("writes \\ql, \\qc and \\qr for an aligned paragraph, with no first-line indent, and \\ql \\fi for the others", () => {
    const rtf = build(
      p("center", "mid"),
      p("end", "right"),
      p("start", "left"),
      p(undefined, "plain"),
    );
    expect(words(rtf, "mid")).toMatch(/\\fi0\\qc$/);
    expect(words(rtf, "right")).toMatch(/\\fi0\\qr$/);
    expect(words(rtf, "left")).toMatch(/\\fi0\\ql$/);
    expect(words(rtf, "plain")).toMatch(/\\fi\d+\\ql$/);
    expect(words(rtf, "plain")).not.toMatch(/\\fi0\\/);
  });

  it("lets a heading override the centring of the first level and the left of the others", () => {
    const h = (level: number, textAlign?: string): DocNode => ({
      type: "heading",
      attrs: { level, ...(textAlign ? { textAlign } : {}) },
      content: [t(`H${level}${textAlign ?? ""}`)],
    });
    const rtf = build(p(undefined, "lead"), h(1), h(1, "end"), h(2), h(2, "center"));
    expect(words(rtf, "H1")).toContain("\\qc");
    expect(words(rtf, "H1end")).toContain("\\qr");
    expect(words(rtf, "H2")).toContain("\\ql");
    expect(words(rtf, "H2center")).toContain("\\qc");
  });

  it("aligns paragraphs in quotes, lists, task items, definitions and table cells", () => {
    const rtf = build(
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
    for (const [text, q] of [
      ["quoted", "qc"],
      ["second", "qr"],
      ["more", "qc"],
      ["meaning", "qr"],
      ["again", "qc"],
      ["cell", "qc"],
    ] as const)
      expect(words(rtf, text), text).toContain(`\\${q}`);
    // The first paragraph of a list item and of a task item carry the marker before their text.
    expect(rtf).toContain("\\fi-360\\qc \\u8226?\\tab first");
    expect(rtf).toContain("\\fi-360\\qr \\u9744?\\tab todo");
  });

  it("refuses any other value", () => {
    for (const bad of ["justify", "left", 4]) {
      expect(() => build(p(bad, "x")), String(bad)).toThrow(RtfExportError);
      expect(() => build(p(bad, "x"))).toThrow(/text alignment .* is not allowed/);
    }
  });
});

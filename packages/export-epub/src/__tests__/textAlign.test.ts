import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { ALIGN_CSS } from "../epub";
import { EpubExportError, buildEpub, chapterToXhtmlBody } from "../index";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (align?: unknown, ...content: DocNode[]): DocNode => ({
  type: "paragraph",
  ...(align === undefined ? {} : { attrs: { textAlign: align as string } }),
  content,
});
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const body = (...content: DocNode[]): string => chapterToXhtmlBody(doc(...content));
const meta = {
  title: "T",
  author: "A",
  language: "en",
  identifier: "urn:uuid:1",
  modified: new Date(0),
};

describe("text alignment", () => {
  it("writes a class on an aligned paragraph or heading and nothing on the others", () => {
    expect(body(p("center", t("a")), p("start", t("b")), p("end", t("c")), p(null, t("d")))).toBe(
      '<p class="align-center">a</p>\n<p class="align-start">b</p>\n<p class="align-end">c</p>\n<p>d</p>',
    );
    expect(
      body({
        type: "heading",
        attrs: { level: 2, textAlign: "center" },
        content: [t("H")],
      }),
    ).toBe('<h2 class="align-center">H</h2>');
  });

  it("aligns paragraphs in quotes, lists, task items, definitions and table cells", () => {
    const out = body(
      { type: "blockquote", content: [p("end", t("q"))] },
      { type: "bulletList", content: [{ type: "listItem", content: [p("center", t("li"))] }] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: false }, content: [p("center", t("ti"))] }],
      },
      {
        type: "definitionList",
        content: [
          { type: "definitionTerm", content: [t("term")] },
          { type: "definitionDescription", content: [p("end", t("d"))] },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [p("center", t("c"))] }],
          },
        ],
      },
    );
    expect(out).toContain('<blockquote><p class="align-end">q</p></blockquote>');
    expect(out).toContain('<li><p class="align-center">li</p></li>');
    expect(out).toContain('<p class="align-center"><label>');
    expect(out).toContain('<dd><p class="align-end">d</p></dd>');
    expect(out).toContain('<td><p class="align-center">c</p></td>');
  });

  it("refuses any other value, naming the node", () => {
    for (const bad of ["justify", "left", 3, ""]) {
      let e: unknown;
      try {
        body(p(bad, t("x")));
      } catch (x) {
        e = x;
      }
      expect(e).toBeInstanceOf(EpubExportError);
      expect((e as EpubExportError).code).toBe("invalid-alignment");
      expect((e as EpubExportError).where.nodeType).toBe("paragraph");
    }
  });

  it("puts the alignment rules after the stylesheet, the built-in one and a template's", () => {
    const files = (css?: string) =>
      strFromU8(
        unzipSync(
          buildEpub(
            meta,
            [{ id: "c", title: "C", doc: doc(p("center", t("x"))) }],
            css ? { css } : {},
          ),
        )["OEBPS/style.css"]!,
      );
    for (const css of [files(), files("body{color:#123}")]) {
      expect(css.endsWith(ALIGN_CSS)).toBe(true);
      expect(css).toContain(".align-center{text-align:center;text-indent:0}");
      expect(css).toContain(".align-start{text-align:start;text-indent:0}");
      expect(css).toContain(".align-end{text-align:end;text-indent:0}");
    }
    expect(files("body{color:#123}").startsWith("body{color:#123}\n")).toBe(true);
  });
});

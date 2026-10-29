import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DocNode } from "@cadabracraft/shared";
import { DocxExportError, buildDocx } from "../index";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const book = { title: "The Long Road", author: "Ada Lovelace" };
const files = (...content: DocNode[]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(unzipSync(buildDocx(book, [{ title: "A", doc: { type: "doc", content } }]))).map(
      ([k, v]) => [k, strFromU8(v)],
    ),
  );
const build = (...content: DocNode[]): string => files(...content)["word/document.xml"]!;
const item = (checked: unknown, ...content: DocNode[]): DocNode => ({
  type: "taskItem",
  ...(checked === undefined ? {} : { attrs: { checked: checked as boolean } }),
  content,
});
const term = (...content: DocNode[]): DocNode => ({ type: "definitionTerm", content });
const desc = (...content: DocNode[]): DocNode => ({ type: "definitionDescription", content });

describe("task lists", () => {
  it("writes a checkbox content control at the start of each item", () => {
    const d = build({
      type: "taskList",
      content: [item(true, p(t("done"))), item(false, p(t("todo"))), item(undefined, p(t("x")))],
    });
    expect(d).toContain('xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"');
    expect(d).toContain('mc:Ignorable="w14"');
    expect(d.match(/<w14:checkbox>/g)).toHaveLength(3);
    expect(d).toContain('<w14:checked w14:val="1"/>');
    expect(d).toContain("☒");
    expect(d).toContain("☐");
    expect(d).toContain("done");
  });
  it("indents nested items and other blocks, and lets a bullet list nest inside", () => {
    const d = build({
      type: "taskList",
      content: [
        item(
          false,
          p(t("a")),
          p(t("more")),
          p(),
          { type: "taskList", content: [item(true, p(t("b")))] },
          { type: "bulletList", content: [{ type: "listItem", content: [p(t("c"))] }] },
        ),
      ],
    });
    expect(d).toContain('w:left="720"');
    expect(d).toContain('w:left="1440"');
    expect(d).toContain("more");
  });
  it("is valid inside a block quote and refuses bad input", () => {
    const quoted = build({
      type: "blockquote",
      content: [{ type: "taskList", content: [item(false, p(t("q")))] }],
    });
    expect(quoted).toContain('w:left="1440"');
    expect(() => build({ type: "taskList", content: [p(t("x"))] })).toThrow(DocxExportError);
    expect(() => build({ type: "taskList", content: [item("yes", p(t("x")))] })).toThrow(
      /checked value/,
    );
    expect(() =>
      build({ type: "taskList", content: [item(true, { type: "sceneBreak" })] }),
    ).toThrow(/start with a paragraph/);
  });
  it("refuses nesting deeper than nine levels", () => {
    let node: DocNode = { type: "taskList", content: [item(false, p(t("deep")))] };
    for (let i = 0; i < 10; i++)
      node = { type: "taskList", content: [item(false, p(t("x")), node)] };
    expect(() => build(node)).toThrow(/9 levels/);
  });
});

describe("definition lists", () => {
  it("uses Word's Definition Term and Definition styles", () => {
    const f = files({
      type: "definitionList",
      content: [
        term(t("Ant")),
        desc(p(t("small")), p(t("busy")), p()),
        term(t("Bee")),
        desc(p(t("buzzes"))),
      ],
    });
    const d = f["word/document.xml"]!;
    expect(d.match(/<w:pStyle w:val="DefinitionTerm"\/>/g)).toHaveLength(2);
    expect(d.match(/<w:pStyle w:val="Definition"\/>/g)).toHaveLength(3);
    expect(f["word/styles.xml"]).toContain('<w:name w:val="Definition Term"/>');
    expect(f["word/styles.xml"]).toContain('<w:name w:val="Definition"/>');
  });
  it("indents inside a block quote and keeps nested blocks of a description", () => {
    const d = build({
      type: "blockquote",
      content: [
        {
          type: "definitionList",
          content: [
            term(t("Ant")),
            desc(p(t("small")), {
              type: "bulletList",
              content: [{ type: "listItem", content: [p(t("x"))] }],
            }),
          ],
        },
      ],
    });
    expect(d).toContain('w:left="720"');
    expect(d).toContain('w:left="1440"');
  });
  it("refuses what Word cannot hold", () => {
    expect(() => build({ type: "definitionList", content: [p(t("x"))] })).toThrow(
      /cannot be written in a definition list/,
    );
    expect(() =>
      build({ type: "definitionList", content: [term(t("a")), desc({ type: "sceneBreak" })] }),
    ).toThrow(/must start with a paragraph/);
    expect(() => build({ type: "definitionList" })).not.toThrow();
  });
});

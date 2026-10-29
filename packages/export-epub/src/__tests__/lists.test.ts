import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { EpubExportError, chapterToXhtmlBody } from "../index";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const body = (...content: DocNode[]): string => chapterToXhtmlBody(doc(...content));
const item = (checked: unknown, ...content: DocNode[]): DocNode => ({
  type: "taskItem",
  ...(checked === undefined ? {} : { attrs: { checked: checked as boolean } }),
  content,
});
const term = (...content: DocNode[]): DocNode => ({ type: "definitionTerm", content });
const desc = (...content: DocNode[]): DocNode => ({ type: "definitionDescription", content });

describe("task lists", () => {
  it("writes a disabled checkbox before the first paragraph of each item", () => {
    expect(
      body({
        type: "taskList",
        content: [item(true, p(t("done"))), item(false, p(t("todo"))), item(undefined, p())],
      }),
    ).toBe(
      '<ul class="task-list">' +
        '<li class="task-item"><p><input type="checkbox" disabled="disabled" checked="checked"/> done</p></li>' +
        '<li class="task-item"><p><input type="checkbox" disabled="disabled"/> todo</p></li>' +
        '<li class="task-item"><p><input type="checkbox" disabled="disabled"/> </p></li></ul>',
    );
  });
  it("nests and keeps the other blocks of an item", () => {
    const out = body({
      type: "taskList",
      content: [
        item(
          false,
          p(t("a")),
          { type: "taskList", content: [item(true, p(t("b")))] },
          p(t("more")),
        ),
      ],
    });
    expect(out).toContain(
      '<p><input type="checkbox" disabled="disabled"/> a</p><ul class="task-list">',
    );
    expect(out).toContain("<p>more</p></li>");
  });
  it("names where a bad node is", () => {
    expect(() => body({ type: "taskList", content: [p(t("x"))] })).toThrow(EpubExportError);
    expect(() => body({ type: "taskList", content: [p(t("x"))] })).toThrow(
      /in taskList: paragraph/,
    );
    expect(() => body({ type: "taskList", content: [item("yes", p(t("x")))] })).toThrow(
      /checked value/,
    );
    expect(() => body({ type: "taskList", content: [item(true, { type: "sceneBreak" })] })).toThrow(
      /must start with a paragraph/,
    );
    expect(() => body({ type: "taskList", content: [{ type: "taskItem" }] })).toThrow(
      /must start with a paragraph/,
    );
    try {
      body({ type: "taskList", content: [item(true, p(), { type: "mystery" } as never)] });
    } catch (e) {
      expect((e as EpubExportError).where?.path).toBe("taskList 1 > taskItem 1 > mystery 2");
    }
  });
});

describe("definition lists", () => {
  it("writes dl, dt and dd", () => {
    expect(
      body({
        type: "definitionList",
        content: [
          term(t("Ant")),
          term(t("Bee")),
          desc(p(t("small")), {
            type: "bulletList",
            content: [{ type: "listItem", content: [p(t("x"))] }],
          }),
        ],
      }),
    ).toBe("<dl><dt>Ant</dt><dt>Bee</dt><dd><p>small</p><ul><li><p>x</p></li></ul></dd></dl>");
  });
  it("throws on an unknown child, an empty list and a description that starts with a list", () => {
    expect(() => body({ type: "definitionList", content: [p(t("x"))] })).toThrow(
      /in definitionList: paragraph/,
    );
    expect(() => body({ type: "definitionList", content: [] })).toThrow(/without entries/);
    expect(() => body({ type: "definitionList" })).toThrow(/without entries/);
    expect(() =>
      body({ type: "definitionList", content: [term(t("a")), desc({ type: "bulletList" })] }),
    ).toThrow(/must start with a paragraph/);
  });
});

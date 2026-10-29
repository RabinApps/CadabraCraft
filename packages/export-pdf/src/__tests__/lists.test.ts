import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import type { DocNode } from "@cadabracraft/shared";
import { PdfExportError } from "../errors";
import { buildTypst } from "../typst";
import { createNodeRunner } from "../node";
import { renderPdf as render } from "../render";
import type { PdfChapter } from "../types";

const book = { title: "Sample Book", author: "Test Author", language: "en" };
const t = (text: string): DocNode => ({ type: "text", text });
const p = (...c: DocNode[]): DocNode => ({ type: "paragraph", content: c });
const ch = (...content: DocNode[]): PdfChapter[] => [
  { id: "c", title: "C", doc: { type: "doc", content } },
];
const build = (...content: DocNode[]) => buildTypst(book, ch(...content));
const item = (checked: unknown, ...c: DocNode[]): DocNode => ({
  type: "taskItem",
  attrs: { checked: checked as boolean },
  content: c,
});
const term = (s: string): DocNode => ({ type: "definitionTerm", content: [t(s)] });
const desc = (...c: DocNode[]): DocNode => ({ type: "definitionDescription", content: c });

describe("task lists", () => {
  it("draws a box per item and ticks the checked ones", () => {
    const src = build({
      type: "taskList",
      content: [item(true, p(t("a"))), item(false, p(t("b"))), item(true, p(t("c")))],
    });
    expect(src).toContain("#enum(numbering: n => task-box(n in (1, 3,)),");
    expect(src).toContain("#let task-box(checked)");
  });
  it("writes an unchecked set for a list with no ticks", () => {
    expect(build({ type: "taskList", content: [item(false, p(t("a")))] })).toContain(
      "task-box(n in ())",
    );
  });
  it("treats a missing checked value as unchecked and refuses a non-boolean", () => {
    expect(
      build({ type: "taskList", content: [{ type: "taskItem", content: [p(t("a"))] }] }),
    ).toContain("n in ()");
    expect(() => build({ type: "taskList", content: [item("yes", p(t("a")))] })).toThrow(
      /checked value/,
    );
  });
  it("throws on a node that is not a task item", () => {
    expect(() => build({ type: "taskList", content: [p(t("a"))] })).toThrow(
      /Unsupported node type/,
    );
  });
});

describe("definition lists", () => {
  it("writes terms and descriptions in order", () => {
    const src = build({
      type: "definitionList",
      content: [term("Ant"), desc(p(t("small"))), term("Bee"), desc(p(t("buzzes")), p(t("flies")))],
    });
    expect(src).toContain("#def-term[Ant]");
    expect(src).toContain("#def-desc[\nsmall\n]");
    expect(src.indexOf("#def-term[Bee]")).toBeGreaterThan(src.indexOf("#def-desc[\nsmall"));
    expect(src).toContain("buzzes\n\nflies");
  });
  it("throws on an unknown child and on an empty list", () => {
    expect(() => build({ type: "definitionList", content: [p(t("x"))] })).toThrow(PdfExportError);
    expect(() => build({ type: "definitionList", content: [] })).toThrow(/without entries/);
    expect(() => build({ type: "definitionList" })).toThrow(/without entries/);
  });
});

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const typstSuite = has("typst", ["--version"]) ? describe : describe.skip;

typstSuite("renderPdf with task and definition lists", () => {
  it("compiles nested task lists and definition lists, with a long list that breaks across pages", async () => {
    const many = Array.from({ length: 80 }, (_, i) => item(i % 3 === 0, p(t(`Task number ${i}`))));
    const { pdf } = await render(
      book,
      ch(
        p(t("Intro")),
        {
          type: "taskList",
          content: [
            item(true, p(t("done")), {
              type: "taskList",
              content: [item(false, p(t("nested")))],
            }),
            ...many,
          ],
        },
        {
          type: "definitionList",
          content: [
            term("Term"),
            desc(p(t("Meaning")), {
              type: "bulletList",
              content: [{ type: "listItem", content: [p(t("point"))] }],
            }),
          ],
        },
      ),
      {},
      createNodeRunner(),
    );
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  }, 120_000);
});

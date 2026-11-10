// Contract: every node and mark in the editor schema (getSchema(extensions)) is accepted by every exporter, so a node
// added to the schema without exporter support fails here instead of at export time in the app.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chapterDocProblem, editorSchema } from "@cadabracraft/editor-schema";
import { buildDocx } from "../index";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";

const t = (text: string, marks?: Mark[]): DocNode => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const cell = (type: "tableCell" | "tableHeader", text: string): DocNode => ({
  type,
  content: [p(t(text))],
});

/** One valid document per node type. A new schema node has no entry, which fails the first test below. */
const NODE_SAMPLES: Record<string, ChapterDoc> = {
  paragraph: doc(p(t("text"))),
  heading: doc({ type: "heading", attrs: { level: 2 }, content: [t("Title")] }),
  blockquote: doc({ type: "blockquote", content: [p(t("quoted"))] }),
  bulletList: doc({
    type: "bulletList",
    content: [{ type: "listItem", content: [p(t("item"))] }],
  }),
  orderedList: doc({
    type: "orderedList",
    attrs: { start: 3 },
    content: [{ type: "listItem", content: [p(t("item"))] }],
  }),
  listItem: doc({
    type: "orderedList",
    content: [{ type: "listItem", content: [p(t("a")), p(t("b"))] }],
  }),
  codeBlock: doc({ type: "codeBlock", attrs: { language: "ts" }, content: [t("let x = 1;")] }),
  hardBreak: doc(p(t("one"), { type: "hardBreak" }, t("two"))),
  image: doc({ type: "image", attrs: { src: "assets/a.png", alt: "alt", title: "Caption" } }),
  sceneBreak: doc({ type: "sceneBreak" }),
  scene: doc({
    type: "scene",
    attrs: { id: "sc-1", title: "Opening", pov: "Mara", status: "draft", target: 800 },
    content: [p(t("In the scene."))],
  }),
  pageBreak: doc({ type: "pageBreak" }),
  footnote: doc(p(t("claim"), { type: "footnote", content: [t("the note")] })),
  table: doc({
    type: "table",
    content: [
      { type: "tableRow", content: [cell("tableHeader", "H1"), cell("tableHeader", "H2")] },
      { type: "tableRow", content: [cell("tableCell", "a"), cell("tableCell", "b")] },
    ],
  }),
  tableRow: doc({
    type: "table",
    content: [{ type: "tableRow", content: [cell("tableCell", "a")] }],
  }),
  tableCell: doc({
    type: "table",
    content: [{ type: "tableRow", content: [cell("tableCell", "a"), cell("tableCell", "b")] }],
  }),
  tableHeader: doc({
    type: "table",
    content: [{ type: "tableRow", content: [cell("tableHeader", "a")] }],
  }),
  taskList: doc({
    type: "taskList",
    content: [
      { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
      { type: "taskItem", attrs: { checked: false }, content: [p(t("todo"))] },
    ],
  }),
  taskItem: doc({
    type: "taskList",
    content: [
      {
        type: "taskItem",
        attrs: { checked: false },
        content: [
          p(t("a")),
          { type: "taskList", content: [{ type: "taskItem", content: [p(t("nested"))] }] },
        ],
      },
    ],
  }),
  definitionList: doc({
    type: "definitionList",
    content: [
      { type: "definitionTerm", content: [t("Term")] },
      { type: "definitionDescription", content: [p(t("Meaning"))] },
    ],
  }),
  definitionTerm: doc({
    type: "definitionList",
    content: [
      { type: "definitionTerm", content: [t("One")] },
      { type: "definitionTerm", content: [t("Two", [{ type: "bold" }])] },
      { type: "definitionDescription", content: [p(t("shared"))] },
    ],
  }),
  definitionDescription: doc({
    type: "definitionList",
    content: [
      { type: "definitionTerm", content: [t("Term")] },
      { type: "definitionDescription", content: [p(t("first")), p(t("second"))] },
      { type: "definitionDescription", content: [p(t("another"))] },
    ],
  }),
};

const MARK_SAMPLES: Record<string, Mark> = {
  comment: { type: "comment", attrs: { id: "t-1" } },
  indexEntry: { type: "indexEntry", attrs: { id: "ix-1", term: "orchard", sub: "wall" } },
  glossaryTerm: { type: "glossaryTerm", attrs: { id: "g-1" } },
  bold: { type: "bold" },
  italic: { type: "italic" },
  underline: { type: "underline" },
  strike: { type: "strike" },
  code: { type: "code" },
  smallCaps: { type: "smallCaps" },
  superscript: { type: "superscript" },
  subscript: { type: "subscript" },
  link: { type: "link", attrs: { href: "https://example.com/" } },
  lang: { type: "lang", attrs: { lang: "fr-CA" } },
};
const markDoc = (m: Mark): ChapterDoc => doc(p(t("marked", [m])));

const png = new Uint8Array(
  readFileSync(new URL("../../../../fixtures/assets/pixel.png", import.meta.url)),
);
const EXPORTERS: Record<string, (d: ChapterDoc) => unknown> = {
  docx: (d) =>
    buildDocx({ title: "T", author: "A" }, [{ title: "C", doc: d }], {
      assets: new Map([["assets/a.png", png]]),
    }),
};

const schema = editorSchema();
const nodeNames = Object.keys(schema.nodes).filter((n) => n !== "doc" && n !== "text");
const markNames = Object.keys(schema.marks);

describe("editor schema contract", () => {
  it("has a sample for every node and mark in the schema, and none for removed ones", () => {
    expect(Object.keys(NODE_SAMPLES).sort()).toEqual([...nodeNames].sort());
    expect(Object.keys(MARK_SAMPLES).sort()).toEqual([...markNames].sort());
  });

  it.each(nodeNames)("the %s sample is a valid chapter", (n) => {
    expect(chapterDocProblem(NODE_SAMPLES[n])).toBeNull();
  });
  it.each(markNames)("the %s sample is a valid chapter", (m) => {
    expect(chapterDocProblem(markDoc(MARK_SAMPLES[m]!))).toBeNull();
  });

  describe.each(Object.entries(EXPORTERS))("%s exporter", (_name, run) => {
    it.each(nodeNames)("exports the %s node", (n) => {
      const out = run(NODE_SAMPLES[n]!);
      expect(out).toBeTruthy();
    });
    it.each(markNames)("exports the %s mark", (m) => {
      expect(run(markDoc(MARK_SAMPLES[m]!))).toBeTruthy();
    });
  });
});

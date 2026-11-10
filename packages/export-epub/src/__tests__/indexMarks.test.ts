import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode, Mark } from "@cadabracraft/shared";
import { chapterToXhtmlBody } from "../index";

const t = (text: string, ...marks: Mark[]): DocNode => ({ type: "text", text, marks });
const body = (...content: DocNode[]): string =>
  chapterToXhtmlBody({
    type: "doc",
    content: [{ type: "paragraph", content }],
  } as ChapterDoc);

describe("index entry and glossary term marks", () => {
  it("anchors an index entry for the index page to link back to", () => {
    expect(body(t("the wall", { type: "indexEntry", attrs: { id: "ix-1", term: "Wall" } }))).toBe(
      '<p><span id="idx-ix-1">the wall</span></p>',
    );
  });

  it("writes a glossary term as plain text", () => {
    expect(body(t("harbour", { type: "glossaryTerm", attrs: { id: "harbour" } }))).toBe(
      "<p>harbour</p>",
    );
  });

  it("writes an empty anchor id for an entry without one, which the validator refuses earlier", () => {
    expect(body(t("x", { type: "indexEntry", attrs: { term: "X" } }))).toBe(
      '<p><span id="idx-">x</span></p>',
    );
  });
});

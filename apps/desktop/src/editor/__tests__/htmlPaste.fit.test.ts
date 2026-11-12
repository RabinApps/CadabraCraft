import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { getSchema } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import { describe, expect, it } from "vitest";
import { convertHtmlText, fitContent, plainOf } from "../paste/htmlPaste";

const schema = getSchema(extensions);
const text = (t: string, marks?: unknown[]) => ({
  type: "text",
  text: t,
  ...(marks ? { marks } : {}),
});
const p = (t: string) => ({ type: "paragraph", content: [text(t)] });
const stateOf = (content: unknown[]) =>
  EditorState.create({ schema, doc: PMNode.fromJSON(schema, { type: "doc", content }) });
const heading = stateOf([{ type: "heading", attrs: { level: 2 }, content: [text("Title")] }]);
const cell = stateOf([
  {
    type: "table",
    content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("cell")] }] }],
  },
]);
const bold = [{ type: "bold" }];
const quote = { type: "blockquote", content: [p("quoted")] };
const emptyQuote = { type: "blockquote" };

describe("plainOf", () => {
  it("joins text, skips footnotes and separates blocks with a space", () => {
    expect(
      plainOf([
        text("a"),
        { type: "footnote", content: [text("note")] },
        { type: "paragraph", content: [text("b")] },
        { type: "text" },
        { type: "horizontalRule" },
        { type: "bold", content: [text("c")] },
      ] as never),
    ).toBe("ab c");
  });
});

describe("convertHtmlText", () => {
  it("keeps a single paragraph's inline content, even when it has none", () => {
    expect(convertHtmlText("<p></p>").content).toEqual([]);
  });
});

describe("fitContent", () => {
  it("keeps styled text in a heading and flattens everything else to one run", () => {
    const at = 2;
    expect(fitContent(heading, [text("x", bold)] as never, at)).toEqual([text("x", bold)]);
    expect(fitContent(heading, [] as never, at)).toEqual([]);
    expect(fitContent(heading, [quote, p("two")] as never, at)).toEqual([text("quoted two")]);
    expect(fitContent(heading, [emptyQuote] as never, at)).toEqual([]);
  });
  it("turns pasted blocks into paragraphs inside a table cell", () => {
    const at = 5;
    const out = fitContent(
      cell,
      [p("a"), text("b"), quote, emptyQuote, { type: "horizontalRule" }] as never,
      at,
    );
    expect(out).toEqual([p("a"), { type: "paragraph", content: [text("b")] }, p("quoted")]);
    expect(fitContent(cell, [text("inline")] as never, at)).toEqual([text("inline")]);
  });
  it("leaves content alone elsewhere", () => {
    const body = stateOf([p("plain")]);
    expect(fitContent(body, [quote] as never, 2)).toEqual([quote]);
  });
});

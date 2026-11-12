import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { breaksMidWord } from "../decorations";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { group: "inline" },
  },
});
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [schema.text("ab cd")]),
  schema.node("paragraph"),
]);

describe("breaksMidWord", () => {
  it("is true only between two letters", () => {
    expect(breaksMidWord(doc, 2)).toBe(true);
    expect(breaksMidWord(doc, 3)).toBe(false);
    expect(breaksMidWord(doc, 4)).toBe(false);
  });
  it("is false at the edges of the document and of a paragraph", () => {
    expect(breaksMidWord(doc, 0)).toBe(false);
    expect(breaksMidWord(doc, doc.content.size)).toBe(false);
    expect(breaksMidWord(doc, 1)).toBe(false);
    expect(breaksMidWord(doc, 6)).toBe(false);
    expect(breaksMidWord(doc, 7)).toBe(false);
  });
});

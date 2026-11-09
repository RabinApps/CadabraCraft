import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { readSentences } from "../sentenceList";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*" },
    text: { group: "inline", inline: true },
    hardBreak: { group: "inline", inline: true, selectable: false },
  },
});

describe("readSentences", () => {
  it("lists the sentences of every block with ranges that cover exactly their text", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", null, [schema.text("Chapter one")]),
      schema.node("paragraph", null, [schema.text("One. Two!")]),
    ]);
    const list = readSentences(doc);
    expect(list.map((s) => s.text)).toEqual(["Chapter one", "One.", "Two!"]);
    for (const s of list) expect(doc.textBetween(s.from, s.to)).toBe(s.text);
    expect(list.map((s) => s.endsBlock)).toEqual([true, false, true]);
  });

  it("skips inline nodes without adding their position to the text", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("First."),
        schema.node("hardBreak"),
        schema.text("Second."),
      ]),
    ]);
    const list = readSentences(doc);
    expect(list.map((s) => s.text)).toEqual(["First.", "Second."]);
    expect(doc.textBetween(list[1]!.from, list[1]!.to)).toBe("Second.");
  });

  it("returns nothing for a page with no text", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph")]);
    expect(readSentences(doc)).toEqual([]);
  });
});

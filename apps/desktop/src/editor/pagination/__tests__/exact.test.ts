import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { blockKind, blockKinds, plainItems, wordCountOf, wordOffset } from "../exact";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
      toDOM: () => ["h1", 0],
    },
    sceneBreak: { group: "block", toDOM: () => ["hr"] },
    codeBlock: { group: "block", content: "text*", toDOM: () => ["pre", 0] },
    hardBreak: { group: "inline", inline: true, toDOM: () => ["br"] },
    footnote: { group: "inline", inline: true, atom: true, toDOM: () => ["sup"] },
    text: { group: "inline" },
  },
  marks: { code: { toDOM: () => ["code", 0] }, bold: { toDOM: () => ["b", 0] } },
});
const t = (s: string, mark?: string) => schema.text(s, mark ? [schema.mark(mark)] : []);
const para = (...kids: ReturnType<typeof t>[]) => schema.node("paragraph", null, kids);

describe("blockKind", () => {
  it("is the exporter's rule: ordinary paragraphs, other paragraphs, headings, scene breaks, the rest", () => {
    expect(blockKind(para(t("a b"), t("c", "bold"), schema.node("hardBreak")))).toBe("p");
    expect(blockKind(para(t("a", "code")))).toBe("q");
    expect(blockKind(para(t("a"), schema.node("footnote")))).toBe("q");
    expect(blockKind(schema.node("heading", { level: 2 }, [t("H")]))).toBe("h");
    expect(blockKind(schema.node("sceneBreak"))).toBe("s");
    expect(blockKind(schema.node("codeBlock", null, [t("x")]))).toBe("o");
    const doc = schema.node("doc", null, [para(t("a")), schema.node("sceneBreak")]);
    expect(blockKinds(doc)).toEqual(["p", "s"]);
  });
});

describe("words", () => {
  it("counts and places words like the exporter marked them (flat offsets, a hard break takes one)", () => {
    const node = para(t("one two "), t("three", "bold"), schema.node("hardBreak"), t("four  five"));
    expect(plainItems(node)).toEqual(["one two ", "three", null, "four  five"]);
    expect(wordCountOf(node)).toBe(5);
    expect([0, 1, 2, 3, 4].map((w) => wordOffset(node, w))).toEqual([0, 4, 8, 14, 20]);
    expect(wordOffset(node, 5)).toBeNull();
  });

  it("has no words for a paragraph that is not ordinary", () => {
    const node = para(t("a b", "code"));
    expect(plainItems(node)).toBeNull();
    expect(wordCountOf(node)).toBe(0);
    expect(wordOffset(node, 0)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { ChapterDoc, DocNode } from "@cadabracraft/shared";
import { extractOutline } from "../outline";

const text = (t: string): DocNode => ({ type: "text", text: t });
const heading = (level: number, ...content: DocNode[]): DocNode => ({
  type: "heading",
  attrs: { level },
  content,
});
const para = (t: string): DocNode => ({ type: "paragraph", content: [text(t)] });
const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });

describe("extractOutline", () => {
  it("lists the headings in reading order with their level", () => {
    expect(
      extractOutline(doc(heading(1, text("One")), para("body"), heading(2, text("Two")))),
    ).toEqual([
      { index: 0, level: 1, text: "One" },
      { index: 1, level: 2, text: "Two" },
    ]);
  });

  it("returns nothing for no document or one without headings", () => {
    expect(extractOutline(null)).toEqual([]);
    expect(extractOutline(doc(para("just text")))).toEqual([]);
    expect(extractOutline({ type: "doc" } as unknown as ChapterDoc)).toEqual([]);
  });

  it("joins marked text, turns a line break into a space and collapses white space", () => {
    const h = heading(
      3,
      text("A "),
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "hardBreak" },
      text("  title  "),
    );
    expect(extractOutline(doc(h))).toEqual([{ index: 0, level: 3, text: "A bold title" }]);
  });

  it("numbers empty headings but leaves them out, so indexes match the editor", () => {
    const empty = heading(2, text("   "));
    const none: DocNode = { type: "heading", attrs: { level: 2 } };
    expect(extractOutline(doc(empty, none, heading(1, text("Real"))))).toEqual([
      { index: 2, level: 1, text: "Real" },
    ]);
  });

  it("finds headings inside quotes and lists, in document order", () => {
    const quote: DocNode = { type: "blockquote", content: [heading(2, text("Inside"))] };
    expect(extractOutline(doc(heading(1, text("A")), quote, heading(1, text("B"))))).toEqual([
      { index: 0, level: 1, text: "A" },
      { index: 1, level: 2, text: "Inside" },
      { index: 2, level: 1, text: "B" },
    ]);
  });

  it("falls back to level 1 for a level the schema does not allow", () => {
    const bad: DocNode = { type: "heading", attrs: { level: 9 }, content: [text("x")] };
    const missing: DocNode = { type: "heading", content: [text("y")] };
    expect(extractOutline(doc(bad, missing)).map((i) => i.level)).toEqual([1, 1]);
  });
});

import type { ChapterDoc } from "@cadabracraft/shared";
import { describe, expect, it } from "vitest";
import { UnsupportedNodeError } from "../errors";
import { narrate } from "../narrate";

const p = (text: string) => ({
  type: "paragraph" as const,
  content: [{ type: "text" as const, text }],
});
const doc = (...content: ChapterDoc["content"]): ChapterDoc => ({ type: "doc", content });

describe("narrate", () => {
  it("speaks the title first, then paragraphs in order", () => {
    const { blocks } = narrate(doc(p("One."), p("Two.")), "The Quay");
    expect(blocks).toEqual([
      { type: "heading", text: "The Quay" },
      { type: "paragraph", text: "One." },
      { type: "paragraph", text: "Two." },
    ]);
  });

  it("does not repeat a title the chapter already opens with", () => {
    const h = {
      type: "heading" as const,
      attrs: { level: 1 },
      content: [{ type: "text" as const, text: "the quay" }],
    };
    expect(narrate(doc(h, p("Hi.")), "The Quay").blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
    ]);
  });

  it("collapses whitespace and ignores marks", () => {
    const para = {
      type: "paragraph" as const,
      content: [
        { type: "text" as const, text: "a  b\n", marks: [{ type: "bold" as const }] },
        { type: "text" as const, text: " c" },
      ],
    };
    expect(narrate(doc(para)).blocks).toEqual([{ type: "paragraph", text: "a b c" }]);
  });

  it("turns scene breaks into pauses and reads lists and quotes", () => {
    const list = {
      type: "bulletList" as const,
      content: [{ type: "listItem" as const, content: [p("item")] }],
    };
    const quote = { type: "blockquote" as const, content: [p("quoted")] };
    const { blocks } = narrate(doc(p("a"), { type: "sceneBreak" }, list, quote));
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "pause", "paragraph", "paragraph"]);
  });

  it("skips footnotes, images, code and tables and counts them", () => {
    const withNote = {
      type: "paragraph" as const,
      content: [
        { type: "text" as const, text: "Hello" },
        { type: "footnote" as const, content: [p("note")] },
      ],
    };
    const { blocks, skipped } = narrate(
      doc(
        withNote,
        { type: "image", attrs: { src: "a.png" } },
        { type: "codeBlock", content: [{ type: "text", text: "x" }] },
        { type: "table", content: [] },
      ),
    );
    expect(blocks).toEqual([{ type: "paragraph", text: "Hello" }]);
    expect(skipped).toEqual({ footnote: 1, image: 1, codeBlock: 1, table: 1 });
  });

  it("throws on a node it does not know instead of dropping it", () => {
    const bad = { type: "mystery", content: [] } as unknown as ChapterDoc["content"][number];
    expect(() => narrate(doc(bad))).toThrow(UnsupportedNodeError);
    const inline = {
      type: "paragraph",
      content: [{ type: "mystery" }],
    } as unknown as ChapterDoc["content"][number];
    expect(() => narrate(doc(inline))).toThrow(/mystery/);
  });
});

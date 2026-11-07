import { describe, expect, it } from "vitest";
import type { ChapterDoc } from "@cadabracraft/shared";
import { cutDoc, sliceDoc, splitPoints } from "../split/splitPoints";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const doc = (...content: unknown[]) => ({ type: "doc", content }) as ChapterDoc;

describe("splitPoints", () => {
  it("lists top-level headings after the first block, with their level and text", () => {
    const d = doc(h(1, "Title"), p("a"), h(2, "Two"), p("b"), h(3, "Three  \n spaced"));
    expect(splitPoints(d)).toEqual([
      { block: 2, level: 2, text: "Two" },
      { block: 4, level: 3, text: "Three spaced" },
    ]);
  });
  it("leaves out empty headings and headings inside other blocks, and counts them so later text matches", () => {
    const d = doc(
      p("x"),
      { type: "heading", attrs: { level: 2 } },
      { type: "blockquote", content: [h(2, "Quoted")] },
      h(2, "Real"),
    );
    expect(splitPoints(d)).toEqual([{ block: 3, level: 2, text: "Real" }]);
  });
  it("never offers block 0 and honours the from and to bounds", () => {
    const d = doc(h(2, "A"), p("a"), h(2, "B"), p("b"), h(2, "C"));
    expect(splitPoints(d).map((x) => x.text)).toEqual(["B", "C"]);
    expect(splitPoints(d, 2, 4)).toEqual([]);
    expect(splitPoints(d, 1, 4).map((x) => x.text)).toEqual(["B"]);
  });
  it("finds nothing in a document with no content", () => {
    expect(splitPoints({ type: "doc" } as unknown as ChapterDoc)).toEqual([]);
  });
});

describe("sliceDoc and cutDoc", () => {
  const d = doc(h(1, "T"), p("a"), h(2, "B"), p("b"));
  it("slices blocks without changing the original", () => {
    expect(sliceDoc(d, 1, 3).content).toHaveLength(2);
    expect(d.content).toHaveLength(4);
  });
  it("cuts a chapter into two halves that together hold every block", () => {
    const { head, tail } = cutDoc(d, 2);
    expect([...head.content, ...tail.content]).toEqual(d.content);
    expect(tail.content[0]).toEqual(h(2, "B"));
  });
  it("refuses a cut that would leave a half empty or lies outside the document", () => {
    expect(() => cutDoc(d, 0)).toThrow(RangeError);
    expect(() => cutDoc(d, 4)).toThrow(RangeError);
    expect(() => cutDoc(d, 1.5)).toThrow(RangeError);
  });
});

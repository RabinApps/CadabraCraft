import { describe, expect, it } from "vitest";
import type { ChapterDoc } from "@cadabracraft/shared";
import { changeSummary, diffChapters, paragraphsOf } from "../wordDiff";

const p = (text: string) => ({
  type: "paragraph" as const,
  content: [{ type: "text" as const, text }],
});

describe("paragraphsOf", () => {
  it("lists paragraph-like blocks in order, walking into lists, quotes and tables", () => {
    const doc: ChapterDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        p("One"),
        { type: "bulletList", content: [{ type: "listItem", content: [p("Item")] }] },
        { type: "blockquote", content: [p("Quote")] },
        { type: "sceneBreak" },
        { type: "paragraph" },
      ],
    };
    expect(paragraphsOf(doc)).toEqual(["Title", "One", "Item", "Quote"]);
  });
  it("joins marked text and treats a hard break as a space", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "b" },
          ],
        },
      ],
    } as unknown as ChapterDoc;
    expect(paragraphsOf(doc)).toEqual(["a b"]);
  });
  it("is empty for no document", () => expect(paragraphsOf(null)).toEqual([]));
});

describe("diffChapters", () => {
  it("marks identical paragraphs as shared", () => {
    expect(diffChapters(["a b", "c"], ["a b", "c"])).toEqual([
      [{ kind: "same", text: "a b" }],
      [{ kind: "same", text: "c" }],
    ]);
  });
  it("shows the words that changed inside an edited paragraph", () => {
    const lines = diffChapters(
      ["The rain stopped by the time Marta arrived"],
      ["The rain stopped by the time Ilse arrived"],
    );
    expect(lines).toEqual([
      [
        { kind: "same", text: "The rain stopped by the time" },
        { kind: "del", text: "Marta" },
        { kind: "add", text: "Ilse" },
        { kind: "same", text: "arrived" },
      ],
    ]);
  });
  it("shows a paragraph only the other version has as added, and one only the current text has as removed", () => {
    const lines = diffChapters(["keep", "gone"], ["keep", "new one"]);
    expect(lines.map((l) => l.map((x) => x.kind))).toEqual([["same"], ["del", "add"]]);
    expect(diffChapters(["a"], ["a", "extra"])).toEqual([
      [{ kind: "same", text: "a" }],
      [{ kind: "add", text: "extra" }],
    ]);
    expect(diffChapters(["a", "extra"], ["a"])).toEqual([
      [{ kind: "same", text: "a" }],
      [{ kind: "del", text: "extra" }],
    ]);
  });
  it("falls back to whole removals and additions when the inputs are too big to compare", () => {
    const big = Array.from({ length: 2500 }, (_, i) => `p${i}`);
    const other = Array.from({ length: 2500 }, (_, i) => `q${i}`);
    const lines = diffChapters(big, other);
    expect(lines).toHaveLength(5000);
    expect(lines[0]).toEqual([{ kind: "del", text: "p0" }]);
    expect(lines[2500]).toEqual([{ kind: "add", text: "q0" }]);
  });
  it("counts added and removed words", () => {
    const lines = diffChapters(["one two three", "gone paragraph"], ["one 2 three four", "x"]);
    expect(changeSummary(lines)).toEqual({ added: 3, removed: 3 });
  });
});

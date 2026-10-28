import { describe, expect, it } from "vitest";
import type { ChapterDoc } from "@cadabracraft/shared";
import { estimatePages, plainBlocks, wordsPerPage } from "../printEstimate";

const margins = { top: 0.8, bottom: 0.9, inside: 0.9, outside: 0.65 };

describe("wordsPerPage", () => {
  it("grows with the trim size and shrinks with a larger body size", () => {
    const small = wordsPerPage({ w: 5.5, h: 8.5 }, margins, 11);
    expect(wordsPerPage({ w: 6, h: 9 }, margins, 11)).toBeGreaterThan(small);
    expect(wordsPerPage({ w: 5.5, h: 8.5 }, margins, 13)).toBeLessThan(small);
  });
});

describe("estimatePages", () => {
  it("is zero for an empty book and adds half a page per chapter", () => {
    expect(estimatePages(0, 3, 250)).toBe(0);
    expect(estimatePages(500, 2, 250)).toBe(3);
  });
});

describe("plainBlocks", () => {
  it("returns paragraph, heading and quote text in order, skipping empty blocks", () => {
    const doc: ChapterDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "there", marks: [{ type: "bold" }] },
          ],
        },
        { type: "paragraph" },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }],
        },
        { type: "codeBlock", content: [{ type: "text", text: "let x = 1;" }] },
      ],
    } as unknown as ChapterDoc;
    expect(plainBlocks(doc)).toEqual(["One", "Hello there", "Quoted", "let x = 1;"]);
  });
});

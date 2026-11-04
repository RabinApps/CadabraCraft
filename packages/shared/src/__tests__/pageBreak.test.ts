import { describe, expect, it } from "vitest";
import { dropLeadingPageBreak, type ChapterDoc, type DocNode } from "../index";

const doc = (...content: DocNode[]): ChapterDoc => ({ type: "doc", content });
const paragraph = (text: string): DocNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const pageBreak: DocNode = { type: "pageBreak" };

describe("dropLeadingPageBreak", () => {
  it("drops a break that is the page's first block", () => {
    const { doc: out, dropped } = dropLeadingPageBreak(doc(pageBreak, paragraph("After.")));
    expect(dropped).toBe(1);
    expect(out.content).toEqual([paragraph("After.")]);
  });

  it("keeps the second break of two in a row, so that page stays empty", () => {
    const { doc: out, dropped } = dropLeadingPageBreak(
      doc(pageBreak, pageBreak, paragraph("After.")),
    );
    expect(dropped).toBe(1);
    expect(out.content).toEqual([pageBreak, paragraph("After.")]);
  });

  it("returns the same document when the page does not open with a break", () => {
    const original = doc(paragraph("First."), pageBreak, paragraph("After."));
    const { doc: out, dropped } = dropLeadingPageBreak(original);
    expect(dropped).toBe(0);
    expect(out).toBe(original);
  });

  it("copes with a page that holds nothing but the break", () => {
    const { doc: out, dropped } = dropLeadingPageBreak(doc(pageBreak));
    expect(dropped).toBe(1);
    expect(out.content).toEqual([]);
  });
});

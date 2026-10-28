import type { DocNode } from "@cadabracraft/shared";
import { describe, expect, it } from "vitest";
import { Warnings, cellParagraphs, imageItems, AssetRegistry } from "../common";

describe("cellParagraphs", () => {
  it("flattens blocks that lack content and always returns at least one paragraph", () => {
    const empty = (type: string) => ({ type }) as DocNode;
    for (const type of [
      "heading",
      "bulletList",
      "orderedList",
      "blockquote",
      "listItem",
      "table",
      "codeBlock",
    ]) {
      const r = cellParagraphs([empty(type)]);
      expect(r.flattened, type).toBe(true);
      expect(r.paragraphs, type).toEqual([{ type: "paragraph" }]);
    }
    const r = cellParagraphs([
      {
        type: "table",
        content: [
          { type: "tableRow" },
          { type: "tableRow", content: undefined },
          { type: "tableRow", content: [{ type: "tableCell" }] },
        ],
      },
      { type: "image", attrs: { src: "a.png" } },
      { type: "image", attrs: { src: "a.png", alt: "alt" } },
      { type: "sceneBreak" },
    ]);
    expect(r.paragraphs).toEqual([{ type: "paragraph", content: [{ type: "text", text: "alt" }] }]);
  });
});

describe("warnings", () => {
  it("counts a tally without an example and omits the empty example list", () => {
    const w = new Warnings();
    w.tally("t", "info", "message");
    w.tally("t", "info", "message", "same");
    w.tally("t", "info", "message", "same");
    expect(w.list()).toEqual([
      { code: "t", severity: "info", message: "message", count: 3, examples: ["same"] },
    ]);
    const bare = new Warnings();
    bare.tally("t", "info", "message");
    expect(bare.list()).toEqual([{ code: "t", severity: "info", message: "message", count: 1 }]);
  });
});

describe("imageItems", () => {
  it("keeps the alt text of images it cannot import", () => {
    const ctx = { warn: new Warnings(), assets: new AssetRegistry() };
    expect(imageItems("https://x.test/a.png", "remote", null, 1, ctx)).toMatchObject([
      { text: "[Image: remote]" },
    ]);
    expect(imageItems("data:image/png;base64,AA", "data", null, 2, ctx)).toMatchObject([
      { text: "[Image: data]" },
    ]);
    expect(imageItems("C:\\pics\\a.bmp", "", null, 3, ctx)).toEqual([]);
    expect(imageItems("a%ZZ.png?x=1#y", "bad escape", undefined, 4, ctx)).toMatchObject([
      { sep: "block" },
    ]);
    expect(ctx.assets.assets[0]!.sourcePath).toBe("a%ZZ.png");
  });
});

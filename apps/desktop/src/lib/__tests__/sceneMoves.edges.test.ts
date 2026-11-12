import { describe, expect, it } from "vitest";
import { removeScene, unsortedRuns, unsortedWords, type SceneNodeJson } from "../scenes/sceneMoves";

const scene = (id: string): SceneNodeJson =>
  ({
    type: "scene",
    attrs: { id, title: id, synopsis: "", target: null, date: "", cast: [] },
    content: [{ type: "paragraph", content: [{ type: "text", text: "words here" }] }],
  }) as never;

describe("scene moves on unusual documents", () => {
  it("leaves an empty paragraph when the last block is lifted out", () => {
    const only = { type: "doc", content: [scene("a")] };
    const r = removeScene(only, "a")!;
    expect(r.doc.content).toEqual([{ type: "paragraph" }]);
  });
  it("finds no runs in a document with no blocks or only empty paragraphs", () => {
    expect(unsortedRuns({ type: "doc" })).toEqual([]);
    expect(unsortedRuns({ type: "doc", content: "nope" })).toEqual([]);
    expect(unsortedRuns({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
    expect(unsortedWords({ type: "doc" })).toBe(0);
  });
});

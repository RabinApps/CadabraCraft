import type { TocItem } from "@cadabracraft/format";
import { describe, expect, it } from "vitest";
import { commentAnchors, commentQuote } from "../comments/comments";
import { tocMovePlace } from "../toc/tocView";

const item = (key: string, part?: string): TocItem =>
  ({ key, kind: "page", entryId: key, level: 0, title: key, ...(part ? { part } : {}) }) as never;

describe("tocMovePlace edge cases", () => {
  const items = [item("c1"), item("p1", "p1"), item("c2", "p1"), item("c3", "p1")];
  it("stays put for a missing row, a move to its own place and a move inside its own block", () => {
    expect(tocMovePlace(items, 9, 0)).toBe(9);
    expect(tocMovePlace(items, 0, 0)).toBe(0);
    expect(tocMovePlace(items, -3, 1)).toBe(-3);
    expect(tocMovePlace(items, 1, 3)).toBe(1);
  });
  it("clamps a target past either end", () => {
    expect(tocMovePlace(items, 3, -50)).toBe(2);
    expect(tocMovePlace(items, 2, 99)).toBe(3);
  });
  it("keeps a child at the top of a block that does not start with its part", () => {
    const loose = [item("x", "p"), item("y", "p"), item("z", "p")];
    expect(tocMovePlace(loose, 2, 0)).toBe(0);
  });
});

describe("comment anchors on sparse nodes", () => {
  it("reads nodes whose marks or content are present but empty", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: undefined },
        { type: "paragraph", content: [{ type: "text", text: "a", marks: undefined }] },
        {
          type: "paragraph",
          marks: undefined,
          content: [{ type: "text", text: "b", marks: [{ type: "comment", attrs: { id: "t1" } }] }],
        },
        { type: "paragraph", marks: [{ type: "comment" }], content: [] },
      ],
    };
    expect(commentAnchors(doc as never)).toEqual(["t1"]);
    expect(commentAnchors(null)).toEqual([]);
    expect(commentQuote(doc as never, "t1")).toBe("b");
    expect(commentQuote(null, "t1")).toBe("");
  });
});

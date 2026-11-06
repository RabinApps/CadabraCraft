import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPreviewJump,
  requestPreviewJump,
  takePreviewJump,
  usePreviewJump,
} from "../pages/previewJump";

beforeEach(clearPreviewJump);

describe("preview jump", () => {
  it("is taken once, by the editor of the chapter it is for", () => {
    requestPreviewJump({ id: "a", block: 3, leaf: 1, word: 7 });
    expect(takePreviewJump("b")).toBeNull();
    expect(usePreviewJump.getState().pending).toEqual({ id: "a", block: 3, leaf: 1, word: 7 });
    expect(takePreviewJump("a")).toEqual({ id: "a", block: 3, leaf: 1, word: 7 });
    expect(takePreviewJump("a")).toBeNull();
  });

  it("keeps the click of a word with the target", () => {
    const click = { tokens: ["a", "b", "c"], index: 2 };
    const target = { id: "a", block: 1, leaf: 0, word: 3 };
    requestPreviewJump(target, click);
    expect(takePreviewJump("a")).toEqual({ ...target, click });
  });

  it("is nothing when there is nothing to take, or no chapter is open", () => {
    expect(takePreviewJump("a")).toBeNull();
    requestPreviewJump({ id: "a", block: 0, leaf: 0, word: null });
    expect(takePreviewJump(null)).toBeNull();
  });
});

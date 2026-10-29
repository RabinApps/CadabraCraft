import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPreviewJump,
  requestPreviewJump,
  takePreviewJump,
  usePreviewJump,
} from "../previewJump";

beforeEach(clearPreviewJump);

describe("preview jump", () => {
  it("is taken once, by the editor of the chapter it is for", () => {
    requestPreviewJump({ id: "a", block: 3, word: 7 });
    expect(takePreviewJump("b")).toBeNull();
    expect(usePreviewJump.getState().pending).toEqual({ id: "a", block: 3, word: 7 });
    expect(takePreviewJump("a")).toEqual({ id: "a", block: 3, word: 7 });
    expect(takePreviewJump("a")).toBeNull();
  });

  it("is nothing when there is nothing to take, or no chapter is open", () => {
    expect(takePreviewJump("a")).toBeNull();
    requestPreviewJump({ id: "a", block: 0, word: null });
    expect(takePreviewJump(null)).toBeNull();
  });
});

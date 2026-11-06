import { describe, expect, it } from "vitest";
import { setCommentInserter, useCommentAnchor } from "../comments/commentAnchor";

describe("comment anchor", () => {
  it("keeps the editor's inserter while it is mounted and forgets it, and the selection, on unmount", () => {
    expect(useCommentAnchor.getState().insert).toBeNull();
    setCommentInserter((id) => id === "c-1");
    useCommentAnchor.setState({ hasSelection: true });
    expect(useCommentAnchor.getState().insert?.("c-1")).toBe(true);
    expect(useCommentAnchor.getState().hasSelection).toBe(true);
    setCommentInserter(null);
    expect(useCommentAnchor.getState()).toMatchObject({ insert: null, hasSelection: false });
  });
});

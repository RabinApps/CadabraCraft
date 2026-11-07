import { create } from "zustand";

interface CommentAnchorState {
  /** True while text is selected in the editor, so a comment can be put on it. */
  hasSelection: boolean;
  /**
   * Puts a `comment` mark with this id on the editor's selection; false when there is none or the mark cannot go
   * there. Registered by the editor while it is shown, null otherwise.
   */
  insert: ((id: string) => boolean) | null;
}

/** The editor's selection, for the comments rail: it decides whether a new comment can be anchored, and anchors it. */
export const useCommentAnchor = create<CommentAnchorState>(() => ({
  hasSelection: false,
  insert: null,
}));

/** Called by the editor on mount (and with null on unmount). */
export const setCommentInserter = (insert: ((id: string) => boolean) | null): void => {
  useCommentAnchor.setState(insert ? { insert } : { insert: null, hasSelection: false });
};

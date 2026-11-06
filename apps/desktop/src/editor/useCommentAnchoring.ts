import { useEffect } from "react";
import { t } from "@lingui/core/macro";
import type { Editor } from "@tiptap/react";
import { setCommentInserter, useCommentAnchor } from "../lib/comments/commentAnchor";
import { useProject } from "../state/project/index";

/**
 * Connects the editor to the comments rail: the rail asks whether text is selected and, when the author sends a comment,
 * puts the `comment` mark with the new thread's id on that selection. Registered while the editor is shown.
 */
export function useCommentAnchoring(editor: Editor | null, hasSelection: boolean): void {
  useEffect(() => {
    if (!editor) return;
    setCommentInserter((id) => {
      if (editor.isDestroyed || editor.state.selection.empty) return false;
      const ok = editor.chain().setMark("comment", { id }).run();
      if (!ok) useProject.setState({ notice: t`A comment cannot go here` });
      return ok;
    });
    return () => setCommentInserter(null);
  }, [editor]);
  useEffect(() => {
    useCommentAnchor.setState({ hasSelection });
  }, [hasSelection]);
}

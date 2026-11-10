import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { useProject } from "../../state/project/index";
import { takeMarkJump, useMarkJump } from "../../state/pages/markJump";

/** Where the marked words are in the document: the first text that carries the mark (an index place by its id, a glossary term by its entry). */
function findMark(
  editor: Editor,
  kind: "index" | "glossary",
  id: string,
): { from: number; to: number } | null {
  const mark = kind === "index" ? "indexEntry" : "glossaryTerm";
  let range: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (range || !node.isText) return;
    if (node.marks.some((m) => m.type.name === mark && m.attrs.id === id))
      range = { from: pos, to: pos + node.nodeSize };
  });
  return range;
}

/** The Index and Glossary panels open this chapter at a marked place: select the marked words and bring them into view. */
export function useMarkJumpEffect(editor: Editor | null): void {
  const currentId = useProject((s) => s.currentId);
  const requests = useMarkJump((s) => s.count);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const jump = takeMarkJump(currentId);
    if (!jump) return;
    const range = findMark(editor, jump.kind, jump.id);
    if (range) editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  }, [editor, currentId, requests]);
}

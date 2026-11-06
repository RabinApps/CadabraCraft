import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useSceneEditing } from "../lib/scenes/sceneEditing";
import { newSceneId } from "../lib/scenes/scenes";

/** Where a scene starts in the chapter, or -1 when the chapter has no scene with that id. */
function scenePos(doc: PMNode, id: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "scene" && node.attrs.id === id) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Wires the sidebar's scenes and the scene rail to the open chapter: adding a scene, going to one, and changing its notes all
 * have to go through the editor, which is the only copy of the document while it is being written.
 */
export function useSceneEditingBridge(editor: Editor | null) {
  useEffect(() => {
    if (!editor) return;
    const add = (): string | null => {
      if (editor.isDestroyed) return null;
      const id = newSceneId();
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, {
          type: "scene",
          attrs: { id },
          content: [{ type: "paragraph" }],
        })
        .run();
      const pos = scenePos(editor.state.doc, id);
      if (pos < 0) return null;
      editor
        .chain()
        .setTextSelection(pos + 2)
        .scrollIntoView()
        .run();
      return id;
    };
    const open = (id: string): boolean => {
      if (editor.isDestroyed) return false;
      const pos = scenePos(editor.state.doc, id);
      if (pos < 0) return false;
      // The chain's scrollIntoView moves the caret into view inside the page; scrolling the scene's own element instead moves the
      // page surface off its text (the scene is a wrapper, not a box in the layout).
      editor
        .chain()
        .focus()
        .setTextSelection(pos + 1)
        .scrollIntoView()
        .run();
      return true;
    };
    const update = (id: string, attrs: Record<string, unknown>): boolean => {
      if (editor.isDestroyed) return false;
      const pos = scenePos(editor.state.doc, id);
      const node = pos < 0 ? null : editor.state.doc.nodeAt(pos);
      if (!node) return false;
      // The notes are attributes, so changing one is a markup change: the text and the caret stay where they were.
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }),
      );
      return true;
    };
    useSceneEditing.setState({ add, open, update });
    return () => useSceneEditing.setState({ add: null, open: null, update: null });
  }, [editor]);
}

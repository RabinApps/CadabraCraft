import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { textAlignAt } from "@cadabracraft/editor-schema";

/** The toolbar-relevant state of the editor; the bar re-renders only when this changes. */
export function useToolbarState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      smallCaps: e.isActive("smallCaps"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      superscript: e.isActive("superscript"),
      subscript: e.isActive("subscript"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      lang: e.isActive("lang"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      quote: e.isActive("blockquote"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      definitionList: e.isActive("definitionList"),
      image: e.isActive("image"),
      align: textAlignAt(e),
      hasSelection: !e.state.selection.empty,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
}

export type ToolbarState = ReturnType<typeof useToolbarState>;

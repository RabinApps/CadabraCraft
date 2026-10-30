import type { Editor } from "@tiptap/react";

/** Inserts an empty definition list and puts the caret in the empty term nearest to it, so typing fills the term first. */
export function insertDefinitionList(editor: Editor): boolean {
  const ran = editor
    .chain()
    .focus()
    .insertContent({
      type: "definitionList",
      content: [
        { type: "definitionTerm" },
        { type: "definitionDescription", content: [{ type: "paragraph" }] },
      ],
    })
    .run();
  // The caret lands after the inserted node.
  const { doc, selection } = editor.state;
  let term = -1;
  doc.descendants((n, pos) => {
    if (n.type.name === "definitionTerm" && n.content.size === 0)
      if (term < 0 || Math.abs(pos - selection.head) < Math.abs(term - selection.head))
        term = pos + 1;
  });
  if (term >= 0) editor.chain().focus().setTextSelection(term).run();
  return ran;
}

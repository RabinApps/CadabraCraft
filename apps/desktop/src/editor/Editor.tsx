import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import type { ChapterDoc } from "@cadabracraft/shared";

interface Props {
  initial: ChapterDoc;
  onChange: (doc: ChapterDoc) => void;
}

export function Editor({ initial, onChange }: Props) {
  const editor = useEditor({
    extensions,
    content: initial,
    onUpdate: ({ editor }) => onChange(editor.getJSON() as ChapterDoc),
  });
  return <EditorContent editor={editor} />;
}

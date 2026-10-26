import { EditorContent, useEditor } from "@tiptap/react";
import { extensions } from "@cadabracraft/editor-schema";
import type { ChapterDoc } from "@cadabracraft/shared";
import { dirFor } from "../i18n/locales";
import { Toolbar } from "./Toolbar";

interface Props {
  initial: ChapterDoc;
  /** BCP 47 tag from `manifest.language`; sets spellcheck language and base direction. */
  language: string;
  onChange: (doc: ChapterDoc) => void;
}

export function Editor({ initial, language, onChange }: Props) {
  const editor = useEditor({
    extensions,
    editorProps: { attributes: { lang: language, dir: dirFor(language) } },
    content: initial,
    onUpdate: ({ editor }) => onChange(editor.getJSON() as ChapterDoc),
  });
  if (!editor) return null;
  return (
    <>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </>
  );
}

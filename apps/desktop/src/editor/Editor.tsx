import type { CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { extensions, setAssetUrlResolver } from "@cadabracraft/editor-schema";
import type { ChapterDoc } from "@cadabracraft/shared";
import { sizes, widths, type Width } from "../app/reading";
import { dirFor } from "../i18n/locales";
import { assetUrl } from "../lib/assets";
import { useProject } from "../app/store";
import { Toolbar } from "./Toolbar";

// Chapter JSON keeps `assets/...` paths; the webview shows them through blob URLs read via the Tauri bridge.
setAssetUrlResolver((src) => {
  const root = useProject.getState().root;
  return root ? assetUrl(root, src) : Promise.reject(new Error("no project open"));
});

interface Props {
  initial: ChapterDoc;
  /** BCP 47 tag from `manifest.language`; sets spellcheck language and base direction. */
  language: string;
  onChange?: (doc: ChapterDoc) => void;
  /** Read-only reading mode: no toolbar, larger type, no page card. */
  reading?: { size: number; width: Width };
  /** Focus mode: hide the formatting toolbar (shortcuts still work). */
  focus?: boolean;
}

export function Editor({ initial, language, onChange, reading, focus }: Props) {
  const editor = useEditor({
    extensions,
    editorProps: { attributes: { lang: language, dir: dirFor(language) } },
    content: initial,
    editable: !reading,
    onUpdate: ({ editor }) => onChange?.(editor.getJSON() as ChapterDoc),
  });
  if (!editor) return null;
  if (reading) {
    const style = { "--reading-size": `${sizes[reading.size]}rem`, maxWidth: widths[reading.width] } as CSSProperties;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
        <div className="prose-manuscript prose-reading mx-auto px-6 py-8 md:py-14" style={style}>
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!focus && <Toolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto max-md:order-first">
        <div className="mx-auto max-w-[780px] md:p-8">
          <div className="prose-manuscript p-4 md:rounded-md md:border md:border-border md:bg-paper md:px-14 md:py-12">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  );
}

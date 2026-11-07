import type { Editor } from "@tiptap/react";
import { ImagePlus } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { Notice } from "../../ui/feedback/Notice";
import { ImageDialog } from "../toolbar/ToolbarDialogs";
import { useImageDialog } from "../useImageDialog";
import { useEditorFileDrop } from "./useEditorFileDrop";

/**
 * Dropping a picture file on the page: the drop highlight, the warning for files that cannot be added, and the Add image
 * dialog the picture opens in. Rendered inside the page area, which it covers while files are over it.
 */
export function EditorFileDrop({ editor, readOnly }: { editor: Editor; readOnly: boolean }) {
  const { t } = useLingui();
  const dialog = useImageDialog(editor, () => editor.chain().focus());
  const { over, warning } = useEditorFileDrop(!readOnly, dialog.startImageFromPath);
  return (
    <>
      {over && (
        <div
          data-testid="editor-drop-highlight"
          className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-accent-soft/55 text-accent"
        >
          <ImagePlus size={32} aria-hidden />
          <span className="text-base font-semibold">{t`Drop a picture to add it`}</span>
        </div>
      )}
      {/* A live region that stays mounted, so the warning is announced when it appears. */}
      <div
        aria-live="polite"
        data-testid="editor-drop-warning"
        className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center"
      >
        {warning && (
          <Notice tone="warn" className="pointer-events-auto max-w-md shadow-md">
            {warning}
          </Notice>
        )}
      </div>
      <ImageDialog
        image={dialog.image}
        setImage={(next) => {
          dialog.setImage(next);
          if (next === null) editor.commands.focus();
        }}
        onInsert={dialog.applyImage}
      />
    </>
  );
}

import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { convertSelection } from "@cadabracraft/editor-schema";

/**
 * Format > Convert Quotes and Dashes: turns the straight quotes, `--`, `---` and `...` of the selection into typographic
 * ones (one undo step). Returns the toolbar's menu-only actions (the language ones passed in, plus this) and a message for the toolbar's live region, since the command has no visible control state.
 */
export function useConvertQuotes(
  editor: Editor,
  lang: { openLang: () => void; clearLang: () => void },
) {
  const { t } = useLingui();
  const [note, setNote] = useState("");
  const run = () => {
    const changed = convertSelection(editor);
    setNote(
      changed
        ? t`Converted quotes and dashes in the selection`
        : t`No straight quotes or dashes to convert in the selection`,
    );
    editor.commands.focus();
  };
  return { note, actions: { ...lang, convertQuotes: run } };
}

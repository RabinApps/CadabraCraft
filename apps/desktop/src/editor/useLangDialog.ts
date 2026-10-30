import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { isLangTag } from "@cadabracraft/shared";
import type { LangDraft } from "./ToolbarDialogs";

/**
 * State and actions of the Language of selection dialog and its Clear language command. With the caret inside a language
 * mark (nothing selected) the whole mark is the target; with a selection, only the selection.
 */
export function useLangDialog(editor: Editor, chain: () => ReturnType<Editor["chain"]>) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<LangDraft | null>(null);
  const target = () => (editor.state.selection.empty ? chain().extendMarkRange("lang") : chain());
  const openLang = () => {
    const tag = String(editor.getAttributes("lang").lang ?? "");
    setDraft({ tag, current: tag !== "" });
  };
  const applyLang = () => {
    if (!draft) return;
    const tag = draft.tag.trim();
    if (!isLangTag(tag)) {
      setDraft({
        ...draft,
        error: t`Use letters, digits and single hyphens, up to 35 characters (for example fr-CA).`,
      });
      return;
    }
    if (editor.state.selection.empty && !draft.current) {
      setDraft({ ...draft, error: t`Select the text first.` });
      return;
    }
    target().setMark("lang", { lang: tag }).run();
    setDraft(null);
  };
  const clearLang = () => {
    target().unsetMark("lang").run();
    setDraft(null);
  };
  return { draft, setDraft, openLang, applyLang, clearLang };
}

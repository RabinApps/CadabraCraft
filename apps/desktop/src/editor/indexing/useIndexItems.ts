import { useLingui } from "@lingui/react/macro";
import { BookA, BookMarked } from "lucide-react";
import type { ToolbarItem } from "../toolbar/types";

/** What opens the two dialogs: the Index entry and Glossary term commands of the More formatting and Insert menus. */
export interface MarkOpeners {
  openIndex: () => void;
  openGlossary: () => void;
}

/** The Index entry and Glossary term commands (`editor.indexEntry`, `editor.glossaryTerm`). */
export function useIndexItems(hasSelection: boolean, marks: MarkOpeners): ToolbarItem[] {
  const { t } = useLingui();
  return [
    {
      id: "indexEntry",
      label: t`Index entry…`,
      icon: BookA,
      disabled: !hasSelection,
      run: marks.openIndex,
    },
    { id: "glossaryTerm", label: t`Glossary term…`, icon: BookMarked, run: marks.openGlossary },
  ];
}

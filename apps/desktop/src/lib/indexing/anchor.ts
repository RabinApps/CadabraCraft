import { create } from "zustand";

interface MarkAnchorState {
  /** True while words are selected in the editor, so an index entry or a glossary term can be put on them. */
  hasSelection: boolean;
  /** Opens the dialog that marks the selection as an index entry; registered by the editor while it is shown. */
  openIndex: (() => void) | null;
  /** Opens the dialog that adds a glossary term (and marks the selection with it, when there is one). */
  openGlossary: (() => void) | null;
}

/** The editor's side of the Index and Glossary panels: whether words are selected, and the dialogs that mark them. */
export const useMarkAnchor = create<MarkAnchorState>(() => ({
  hasSelection: false,
  openIndex: null,
  openGlossary: null,
}));

/** Called by the editor on mount (and with nulls on unmount). */
export const setMarkOpeners = (
  openers: { openIndex: () => void; openGlossary: () => void } | null,
): void => {
  useMarkAnchor.setState(
    openers ? openers : { openIndex: null, openGlossary: null, hasSelection: false },
  );
};

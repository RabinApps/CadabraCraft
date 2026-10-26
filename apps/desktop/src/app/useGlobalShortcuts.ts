import { useEffect } from "react";
import { useProject } from "./store";

/** Escape leaves focus mode, unless a dialog or menu is open and should take the key first. */
function useFocusEscape(focus: boolean, exitFocus: () => void) {
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      // The editor marks Escape as handled, so defaultPrevented is no signal.
      if (e.key === "Escape" && !document.querySelector("[role=dialog], [role=menu]")) exitFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, exitFocus]);
}

/** Book-level undo/redo (chapter list edits): Mod+Alt+Z / Mod+Alt+Shift+Z. Mod+Z, Mod+Shift+Z and Mod+Y stay with the editor's text undo. */
function useBookUndo(open: boolean) {
  const actions = useProject((s) => s.actions);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.code !== "KeyZ" || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      void (e.shiftKey ? actions.redo() : actions.undo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, actions]);
}

/** Keyboard shortcuts that work anywhere in the window. */
export function useGlobalShortcuts({ open, focus, exitFocus }: { open: boolean; focus: boolean; exitFocus: () => void }) {
  useFocusEscape(focus, exitFocus);
  useBookUndo(open);
}

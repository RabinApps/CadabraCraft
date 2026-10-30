import { Extension } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";

/** Blocks where Tab already has a job (list indent, next table cell); everywhere else Tab types a tab character. */
const OWN_TAB = ["bulletList", "orderedList", "taskList", "table"];

/**
 * Tab types a tab character and keeps the focus in the editor instead of moving it to the next control. Escape first lets the next
 * Tab leave (so keyboard users are never trapped); lists and tables keep their own Tab (and a Tab they cannot use stays in the
 * editor); a Tab over a selection does nothing rather than replace the text; Shift+Tab leaves as usual.
 */
export const TabKey = Extension.create({
  name: "tabKey",
  priority: 50,
  addProseMirrorPlugins() {
    let escaped = false;
    return [
      new Plugin({
        props: {
          handleKeyDown: (view, event) => {
            // A key that belongs to an input method (a composition) is not ours: Escape cancels it, Tab picks a candidate.
            if (event.isComposing || event.keyCode === 229) return false;
            if (event.key === "Escape") {
              escaped = true;
              return false;
            }
            if (event.key !== "Tab") {
              escaped = false;
              return false;
            }
            if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
            if (escaped) {
              escaped = false;
              return false;
            }
            // The list and table keys run first. When Tab reaches here inside one, they could not act (the first item of a list
            // cannot be indented): the key is still the editor's, or the focus would leave the editor.
            if (OWN_TAB.some((name) => this.editor.isActive(name)) || !view.state.selection.empty) {
              event.preventDefault();
              return true;
            }
            this.editor.commands.insertContent("\t");
            event.preventDefault();
            return true;
          },
          handleDOMEvents: {
            // Leaving the editor with the mouse or by other means ends the Escape that was waiting for a Tab.
            blur: () => {
              escaped = false;
              return false;
            },
          },
        },
      }),
    ];
  },
});

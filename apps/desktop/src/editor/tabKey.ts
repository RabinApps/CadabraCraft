import { Extension } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";

/** Blocks where Tab already has a job (list indent, next table cell); everywhere else Tab types a tab character. */
const OWN_TAB = ["bulletList", "orderedList", "taskList", "table"];

/**
 * Tab types a tab character and keeps the focus in the editor instead of moving it to the next control. Escape first lets the next
 * Tab leave (so keyboard users are never trapped); lists and tables keep their own Tab; Shift+Tab leaves as usual.
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
            if (OWN_TAB.some((name) => this.editor.isActive(name))) return false;
            this.editor.commands.insertContent("\t");
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

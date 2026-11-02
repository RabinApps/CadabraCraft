import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Decorations that give each footnote a role and a name ("Footnote 2"); the stored document and the schema are untouched. */
export function footnoteDecorations(doc: PMNode, label: (n: number) => string): DecorationSet {
  const found: Decoration[] = [];
  let n = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== "footnote") return true;
    n += 1;
    found.push(Decoration.node(pos, pos + node.nodeSize, { role: "note", "aria-label": label(n) }));
    return false;
  });
  return DecorationSet.create(doc, found);
}

/**
 * The footnote text sits inline in the page, so a screen reader had only the bare text ("Note"). The span becomes a `note` named "Footnote N" (N counts from the start of the chapter), and its text stays readable inside it.
 */
export const FootnoteA11y = (label: (n: number) => string) =>
  Extension.create({
    name: "footnoteA11y",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("footnoteA11y"),
          props: { decorations: (state) => footnoteDecorations(state.doc, label) },
        }),
      ];
    },
  });

import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import type { GlossaryEntry } from "@cadabracraft/shared";

/** A transaction with this meta redraws the markers (the glossary changed, so a definition in a tooltip may have). */
export const markersKey = new PluginKey<DecorationSet>("indexMarkers");

/** The words a mark's tooltip says: "Index: Magic, spells" or "Glossary: Orb: a glass sphere". */
export interface MarkerLabels {
  index: (
    term: string,
    sub: string | undefined,
    see: string | undefined,
    seeAlso: string | undefined,
  ) => string;
  glossary: (entry: GlossaryEntry | undefined) => string;
}

const MARKS = ["indexEntry", "glossaryTerm"];

/** The tooltips of the marked words: one decoration per text with an index entry or a glossary term on it. */
function decorate(
  doc: Node,
  entries: () => ReadonlyMap<string, GlossaryEntry>,
  labels: MarkerLabels,
): DecorationSet {
  const found: Decoration[] = [];
  const known = entries();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const tips: string[] = [];
    for (const m of node.marks) {
      if (!MARKS.includes(m.type.name)) continue;
      const a = m.attrs as Record<string, string | null>;
      tips.push(
        m.type.name === "indexEntry"
          ? labels.index(
              a.term ?? "",
              a.sub ?? undefined,
              a.see ?? undefined,
              a.seeAlso ?? undefined,
            )
          : labels.glossary(known.get(a.id ?? "")),
      );
    }
    if (tips.length)
      found.push(Decoration.inline(pos, pos + node.nodeSize, { title: tips.join("\n") }));
  });
  return DecorationSet.create(doc, found);
}

/**
 * Gives the words marked as an index entry or a glossary term a tooltip. The bar under them is CSS on the mark's own element
 * (`[data-index-entry]`, `[data-glossary]`), so the marker is drawn even where this plugin is absent. Decorations only: the document
 * never changes.
 */
export const IndexMarkers = (
  entries: () => ReadonlyMap<string, GlossaryEntry>,
  labels: MarkerLabels,
) =>
  Extension.create({
    name: "indexMarkers",
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: markersKey,
          state: {
            init: (_c, state: EditorState) => decorate(state.doc, entries, labels),
            apply: (tr, set, _old, state) =>
              tr.docChanged || tr.getMeta(markersKey) ? decorate(state.doc, entries, labels) : set,
          },
          props: { decorations: (state) => markersKey.getState(state) },
        }),
      ];
    },
  });

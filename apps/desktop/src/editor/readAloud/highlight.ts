import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** The range being read aloud, or null. Set with a transaction meta; a decoration, so the text itself never changes. */
export const readAloudKey = new PluginKey<DecorationSet>("readAloud");

interface Span {
  from: number;
  to: number;
}

const decorate = (state: EditorState, span: Span | null): DecorationSet =>
  span && span.to > span.from
    ? DecorationSet.create(state.doc, [
        Decoration.inline(span.from, span.to, { class: "read-aloud-current" }),
      ])
    : DecorationSet.empty;

/** The highlight extension: holds one decoration, replaced on every sentence and cleared when reading stops. */
export const ReadAloudHighlight = Extension.create({
  name: "readAloudHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: readAloudKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, set: DecorationSet, _old: EditorState, state: EditorState) {
            const meta = tr.getMeta(readAloudKey) as Span | null | undefined;
            if (meta !== undefined) return decorate(state, meta);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => readAloudKey.getState(state),
        },
      }),
    ];
  },
});

/** Shows the highlight on `span` (or clears it with null). Moves no selection and takes no focus. */
export function setHighlight(editor: Editor, span: Span | null): void {
  const tr = editor.state.tr.setMeta(readAloudKey, span).setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

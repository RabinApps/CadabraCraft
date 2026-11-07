import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { charBefore, textAfter } from "./context";
import { convertText } from "./convertText";
import { quoteStyle } from "./quoteStyle";
import type { SmartTypographyOptions } from "./rules";

interface Edit {
  from: number;
  to: number;
  text: string;
  marks: readonly Mark[];
}

/** The language set on the typography extension, or English when the editor has none. */
const editorLanguage = (editor: Editor): string =>
  (
    editor.extensionManager.extensions.find((e) => e.name === "smartTypography")?.options as
      SmartTypographyOptions | undefined
  )?.language() ?? "en";

/**
 * Converts the straight quotes, `--`, `---` and `...` of the selected text. Code (the code mark and code blocks) and
 * passages marked as another language are left as they are. `language` defaults to the editor's edition language.
 * One undo step. Returns whether anything changed.
 */
export function convertSelection(editor: Editor, language?: string): boolean {
  const { doc, selection, schema } = editor.state;
  const style = quoteStyle(language ?? editorLanguage(editor));
  const edits: Edit[] = [];
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isText || node.marks.some((m) => m.type.spec.code || m.type.name === "lang"))
      return true;
    const from = Math.max(selection.from, pos);
    const to = Math.min(selection.to, pos + node.nodeSize);
    const text = convertText(node.text!.slice(from - pos, to - pos), style, {
      before: charBefore(doc.resolve(from)),
      after: textAfter(doc.resolve(to)),
    });
    edits.push({ from, to, text, marks: node.marks });
    return true;
  });
  const tr = editor.state.tr;
  let changed = false;
  for (const e of edits.reverse()) {
    if (doc.textBetween(e.from, e.to) === e.text) continue;
    tr.replaceWith(e.from, e.to, schema.text(e.text, e.marks));
    changed = true;
  }
  if (changed) editor.view.dispatch(tr);
  return changed;
}

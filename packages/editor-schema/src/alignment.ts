import { Extension, type Editor } from "@tiptap/core";
import { parseTextAlign, type TextAlign } from "@cadabracraft/shared";
import { EDITOR_KEY_COMMANDS, withCase } from "./keys";

/** The blocks that can be aligned: paragraphs (also in quotes, list items, task items, definitions and table cells) and headings. */
const ALIGNABLE = ["paragraph", "heading"];

/** The alignment a pasted element asks for: our own attribute, or `text-align` / the `align` attribute of other editors' HTML (left is the start in the left-to-right text the paste assumes). Justified and anything else is the template's. */
export function alignOfElement(el: HTMLElement): TextAlign | null {
  const own = parseTextAlign(el.getAttribute("data-text-align"));
  if (own) return own;
  const css = (el.style?.textAlign || el.getAttribute("align") || "").toLowerCase();
  return css === "center"
    ? "center"
    : css === "left" || css === "start"
      ? "start"
      : css === "right" || css === "end"
        ? "end"
        : null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textAlign: {
      /** Align the paragraphs and headings of the selection; `null` goes back to what the template does. */
      setTextAlign: (align: TextAlign | null) => ReturnType;
    };
  }
}

/**
 * Text alignment as a global attribute of paragraphs and headings: `textAlign` is `start`, `center` or `end` (logical, like CSS) or null
 * for the template's own. HTML form: `data-text-align`, which the editor CSS, Page view and Read mode style. Enter keeps the alignment
 * on the new block, like a word processor. Keys: Mod-Shift-L / C / R (start, centre, end).
 */
export const TextAlignment = Extension.create({
  name: "textAlignment",
  addGlobalAttributes: () => [
    {
      types: ALIGNABLE,
      attributes: {
        textAlign: {
          default: null,
          parseHTML: alignOfElement,
          renderHTML: (attrs) => (attrs.textAlign ? { "data-text-align": attrs.textAlign } : {}),
        },
      },
    },
  ],
  addCommands: () => ({
    setTextAlign:
      (align) =>
      ({ commands }) =>
        ALIGNABLE.map((type) => commands.updateAttributes(type, { textAlign: align })).every(
          Boolean,
        ),
  }),
  addKeyboardShortcuts() {
    const keys: Record<string, () => boolean> = {};
    for (const id of ["editor.alignLeft", "editor.alignCenter", "editor.alignRight"]) {
      const command = EDITOR_KEY_COMMANDS[id]!;
      for (const k of withCase(command.key)) keys[k] = () => command.run(this.editor);
    }
    return keys;
  },
});

/** The alignment of the block the selection starts in (null: the template's), for the toolbar and the menus. */
export function textAlignAt(editor: Editor): TextAlign | null {
  return parseTextAlign(editor.state.selection.$from.parent.attrs.textAlign) ?? null;
}

import { Extension, Mark, Node, getSchema, mergeAttributes, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  errMsg,
  isAssetPath,
  normalizeLinkUrl,
  safeHref,
  type ChapterDoc,
} from "@cadabracraft/shared";

export const SceneBreak = Node.create({
  name: "sceneBreak",
  group: "block",
  parseHTML: () => [{ tag: "hr.scene-break" }],
  renderHTML: () => ["hr", { class: "scene-break" }],
});

export const SmallCaps = Mark.create({
  name: "smallCaps",
  parseHTML: () => [{ tag: "span.small-caps" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { class: "small-caps" }),
    0,
  ],
});

export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML: () => [{ tag: "sup" }],
  renderHTML: ({ HTMLAttributes }) => ["sup", HTMLAttributes, 0],
});

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML: () => [{ tag: "sub" }],
  renderHTML: ({ HTMLAttributes }) => ["sub", HTMLAttributes, 0],
});

/** Inline footnote; its text lives in the node content. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  content: "text*",
  parseHTML: () => [{ tag: "span.footnote" }],
  renderHTML: () => ["span", { class: "footnote" }, 0],
});

/**
 * Tables: cells hold paragraphs only (no nested tables, lists or images), and merged cells are not supported, so
 * colspan/rowspan are fixed at 1 (prosemirror-tables needs the attrs to exist) and no column widths are stored.
 */
const singleSpanAttrs = () => ({
  colspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
  rowspan: { default: 1, parseHTML: () => 1, renderHTML: () => ({}) },
});
export const BookTable = Table.configure({ resizable: false });
export const BookTableRow = TableRow;
export const BookTableCell = TableCell.extend({
  content: "paragraph+",
  addAttributes: singleSpanAttrs,
});
export const BookTableHeader = TableHeader.extend({
  content: "paragraph+",
  addAttributes: singleSpanAttrs,
});

/**
 * Task lists: a list whose items each carry a `checked` flag (a checkbox). An item holds a paragraph first, then any blocks,
 * like a list item, so task lists can nest (and hold ordinary lists). The HTML form is `ul[data-type=taskList]` with
 * `li[data-type=taskItem][data-checked]` so pasting it back keeps the state; the editor swaps the static checkbox for a live one.
 */
export const TaskList = Node.create({
  name: "taskList",
  group: "block",
  content: "taskItem+",
  parseHTML: () => [{ tag: 'ul[data-type="taskList"]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => [
    "ul",
    mergeAttributes(HTMLAttributes, { "data-type": "taskList" }),
    0,
  ],
});

export const TaskItem = Node.create({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,
  addAttributes: () => ({
    checked: {
      default: false,
      keepOnSplit: false,
      parseHTML: (el) => el.getAttribute("data-checked") === "true",
      renderHTML: (attrs) => ({ "data-checked": attrs.checked ? "true" : "false" }),
    },
  }),
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem("taskItem"),
      Tab: () => this.editor.commands.sinkListItem("taskItem"),
      "Shift-Tab": () => this.editor.commands.liftListItem("taskItem"),
    };
  },
  parseHTML: () => [
    {
      tag: 'li[data-type="taskItem"]',
      priority: 60,
      contentElement: (el) =>
        (el as HTMLElement).querySelector(":scope > div") ?? (el as HTMLElement),
    },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    "li",
    mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }),
    [
      "label",
      { contenteditable: "false" },
      [
        "input",
        {
          type: "checkbox",
          disabled: "disabled",
          ...(node.attrs.checked ? { checked: "checked" } : {}),
        },
      ],
    ],
    ["div", 0],
  ],
});

/**
 * Definition lists: a term (inline text) followed by one or more descriptions (a paragraph, then any blocks). Several terms may
 * share the descriptions that follow them. Maps to `dl` / `dt` / `dd`.
 */
export const DefinitionList = Node.create({
  name: "definitionList",
  group: "block",
  content: "(definitionTerm+ definitionDescription+)+",
  parseHTML: () => [{ tag: "dl" }],
  renderHTML: ({ HTMLAttributes }) => ["dl", HTMLAttributes, 0],
});

export const DefinitionTerm = Node.create({
  name: "definitionTerm",
  content: "inline*",
  defining: true,
  addKeyboardShortcuts() {
    return {
      // Enter in a term goes on to what follows it (its description, or the next term), the way Enter ends a line of a list: splitting
      // a term would only make another term, and there would be no way to reach the description from the keyboard.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;
        const after = $from.after();
        const next = editor.state.doc.resolve(after).nodeAfter;
        if (!next) return false;
        // Inside a description the caret goes into its first paragraph (one level deeper).
        return editor.commands.setTextSelection(
          next.type.name === "definitionDescription" ? after + 2 : after + 1,
        );
      },
    };
  },
  parseHTML: () => [{ tag: "dt" }],
  renderHTML: ({ HTMLAttributes }) => ["dt", HTMLAttributes, 0],
});

export const DefinitionDescription = Node.create({
  name: "definitionDescription",
  content: "paragraph block*",
  defining: true,
  parseHTML: () => [{ tag: "dd" }],
  renderHTML: ({ HTMLAttributes }) => ["dd", HTMLAttributes, 0],
});

type AssetUrlResolver = (src: string) => Promise<string>;
let assetUrlResolver: AssetUrlResolver | null = null;

/**
 * The webview cannot load a project-relative `assets/...` path, so the app registers a resolver that turns it into a
 * displayable (blob) URL. Stored JSON always keeps the relative path; only the node view swaps what the `<img>` shows.
 */
export function setAssetUrlResolver(fn: AssetUrlResolver | null): void {
  assetUrlResolver = fn;
}

/** Block image with a caption (stored in `title`) and an asset-aware node view. */
export const CaptionedImage = Image.extend({
  addNodeView() {
    return ({ node: initial }) => {
      const dom = document.createElement("figure");
      dom.className = "book-image";
      const img = document.createElement("img");
      const caption = document.createElement("figcaption");
      dom.append(img, caption);
      let shownSrc: string | null = null;
      const render = (attrs: Record<string, unknown>) => {
        const src = String(attrs.src ?? "");
        img.alt = String(attrs.alt ?? "");
        caption.textContent = String(attrs.title ?? "");
        caption.hidden = !attrs.title;
        if (src === shownSrc) return;
        shownSrc = src;
        if (assetUrlResolver && isAssetPath(src)) {
          assetUrlResolver(src).then(
            (url) => {
              if (shownSrc === src) img.src = url;
            },
            () => {
              img.removeAttribute("src");
              img.classList.add("missing-asset");
            },
          );
        } else {
          img.src = src;
        }
      };
      render(initial.attrs);
      return {
        dom,
        update(next) {
          if (next.type !== initial.type) return false;
          render(next.attrs);
          return true;
        },
      };
    };
  },
});

/**
 * The fixed schema. Headings limited to levels 1-3. Horizontal rules are disabled (the scene break replaces them). Code blocks are plain text with an optional `language` string.
 * StarterKit 3 bundles underline, link, strike and inline code; superscript and subscript are our own marks.
 */
export const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    horizontalRule: false,
    link: { openOnClick: false },
  }),
  CaptionedImage,
  SceneBreak,
  SmallCaps,
  Superscript,
  Subscript,
  Footnote,
  BookTable,
  BookTableRow,
  BookTableCell,
  BookTableHeader,
  TaskList,
  TaskItem,
  DefinitionList,
  DefinitionTerm,
  DefinitionDescription,
];

/**
 * The editor commands that have a keyboard shortcut of their own, by the id the app's shortcut list uses. `key` is the
 * default ProseMirror key name (what StarterKit registers); `run` is what the key does.
 */
export const EDITOR_KEY_COMMANDS: Readonly<
  Record<string, { key: string; run: (editor: Editor) => boolean }>
> = {
  "editor.bold": { key: "Mod-b", run: (e) => e.commands.toggleBold() },
  "editor.italic": { key: "Mod-i", run: (e) => e.commands.toggleItalic() },
  "editor.underline": { key: "Mod-u", run: (e) => e.commands.toggleUnderline() },
  "editor.strike": { key: "Mod-Shift-s", run: (e) => e.commands.toggleStrike() },
  "editor.code": { key: "Mod-e", run: (e) => e.commands.toggleCode() },
  "editor.paragraph": { key: "Mod-Alt-0", run: (e) => e.commands.setParagraph() },
  "editor.h1": { key: "Mod-Alt-1", run: (e) => e.commands.toggleHeading({ level: 1 }) },
  "editor.h2": { key: "Mod-Alt-2", run: (e) => e.commands.toggleHeading({ level: 2 }) },
  "editor.h3": { key: "Mod-Alt-3", run: (e) => e.commands.toggleHeading({ level: 3 }) },
  "editor.quote": { key: "Mod-Shift-b", run: (e) => e.commands.toggleBlockquote() },
  "editor.bullets": { key: "Mod-Shift-8", run: (e) => e.commands.toggleBulletList() },
  "editor.numbers": { key: "Mod-Shift-7", run: (e) => e.commands.toggleOrderedList() },
  "editor.codeBlock": { key: "Mod-Alt-c", run: (e) => e.commands.toggleCodeBlock() },
};

/** A key with its Caps Lock twin: ProseMirror names a letter by the character it types, so `Mod-b` and `Mod-B` are two keys. */
const withCase = (key: string): string[] => {
  const upper = key.replace(/[a-z]$/, (c) => c.toUpperCase());
  return upper === key ? [key] : [key, upper];
};

/**
 * Moves editor shortcuts to other keys. `remap` maps a command id (`editor.bold`) to a ProseMirror key name (`Mod-Alt-b`) or to
 * null (no key). The command's own default key is swallowed so it no longer acts, and the new key runs the command. Runs ahead of
 * StarterKit (priority), so the app's settings win; the app guarantees no two commands share a key. Unknown ids are ignored.
 */
export const shortcutRemap = (remap: Readonly<Record<string, string | null>>) =>
  Extension.create({
    name: "shortcutRemap",
    priority: 1000,
    addKeyboardShortcuts() {
      const known = Object.entries(remap).flatMap(([id, key]) => {
        const command = EDITOR_KEY_COMMANDS[id];
        return command ? [{ command, key }] : [];
      });
      const keys: Record<string, () => boolean> = {};
      for (const { command } of known) for (const k of withCase(command.key)) keys[k] = () => true;
      for (const { command, key } of known)
        if (key !== null) for (const k of withCase(key)) keys[k] = () => command.run(this.editor);
      return keys;
    },
  });

/** The link policy lives in `@cadabracraft/shared`; re-exported because the editor toolbar imports it from here. */
export { normalizeLinkUrl };

let cachedSchema: ReturnType<typeof getSchema> | null = null;

/** The ProseMirror schema built from `extensions` (cached). Exporter contract tests walk its `nodes` and `marks`. */
export function editorSchema(): ReturnType<typeof getSchema> {
  return (cachedSchema ??= getSchema(extensions));
}

interface RawNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
}

/** Why `doc` is not a valid chapter in the real editor schema (the one the app and exporters use), or null if it is valid. */
export function chapterDocProblem(doc: unknown): string | null {
  if (!doc || typeof doc !== "object" || (doc as { type?: unknown }).type !== "doc")
    return 'a chapter document must be an object with type "doc"';
  try {
    PMNode.fromJSON(editorSchema(), doc).check();
  } catch (e) {
    return errMsg(e);
  }
  // The schema's heading `levels` option only limits the editor's commands; the node spec itself accepts any level.
  let bad: unknown = null;
  let tableBad: string | null = null;
  let badHref: string | null = null;
  let badChecked = false;
  const walk = (n: RawNode) => {
    if (n.type === "heading" && ![1, 2, 3].includes(Number(n.attrs?.level))) bad ??= n.attrs?.level;
    for (const m of n.marks ?? [])
      if (m.type === "link" && safeHref(String(m.attrs?.href ?? "")) === null)
        badHref ??= String(m.attrs?.href ?? "");
    if (
      n.type === "taskItem" &&
      n.attrs?.checked !== undefined &&
      typeof n.attrs.checked !== "boolean"
    )
      badChecked = true;
    if (n.type === "table") tableBad ??= tableProblem(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc as RawNode);
  if (bad !== null) return `heading level ${String(bad)} is not allowed (levels 1-3 only)`;
  if (badHref !== null)
    return `link ${JSON.stringify(badHref)} is not allowed (only http, https and mailto links)`;
  if (badChecked) return "a task item's checked value must be true or false";
  return tableBad;
}

/** Tables must be rectangular and unmerged: every row has the same number of cells, each with colspan and rowspan 1. */
function tableProblem(table: RawNode): string | null {
  /* v8 ignore next -- only called after PMNode.check(), which requires table rows */
  const rows = table.content ?? [];
  let width = -1;
  for (const [i, row] of rows.entries()) {
    const cells = row.content ?? [];
    for (const c of cells) {
      if (Number(c.attrs?.colspan ?? 1) !== 1 || Number(c.attrs?.rowspan ?? 1) !== 1)
        return "merged table cells (colspan/rowspan) are not supported";
    }
    if (cells.length === 0) return `table row ${i + 1} has no cells`;
    if (width < 0) width = cells.length;
    else if (cells.length !== width)
      return `table row ${i + 1} has ${cells.length} cells but the first row has ${width} (tables must be rectangular)`;
  }
  return null;
}

/** Runtime check that `doc` is a valid chapter document (see `chapterDocProblem`). */
export const isChapterDoc = (doc: unknown): doc is ChapterDoc => chapterDocProblem(doc) === null;

/** Throws with the schema problem unless `doc` is a valid chapter document. */
export function assertChapterDoc(doc: unknown): asserts doc is ChapterDoc {
  const problem = chapterDocProblem(doc);
  if (problem) throw new Error(`invalid chapter document: ${problem}`);
}

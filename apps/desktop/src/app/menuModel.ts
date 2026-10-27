import { t } from "@lingui/core/macro";
import type { MatterKind } from "@cadabracraft/shared";
import type { Commands } from "./commands";

/** What the native menu shows, as plain data. `nativeMenu.ts` turns it into the operating system's menu. */
export type PredefinedKind = "Undo" | "Redo" | "Cut" | "Copy" | "Paste" | "SelectAll" | "Minimize" | "Maximize" | "Fullscreen" | "CloseWindow" | "Quit" | "Services" | "Hide" | "HideOthers" | "ShowAll" | "BringAllToFront" | "About";

export type MenuEntry =
  | { kind: "command"; id: string; arg?: string; text: string; enabled: boolean; checked?: boolean; accelerator?: string }
  | { kind: "predefined"; item: PredefinedKind; text?: string }
  | { kind: "separator" }
  | { kind: "submenu"; text: string; items: MenuEntry[] };

export interface MenuContext {
  /** macOS puts the app menu (About, Settings, Quit) first; other systems keep Settings and Quit under File. */
  mac: boolean;
  /** Which commands exist and which are usable right now. */
  commands: Commands;
  recents: readonly { root: string; title: string }[];
  /** Label of the book-level edit that Undo / Redo would revert, e.g. "Add Chapter 2". */
  undoLabel: string | null;
  redoLabel: string | null;
}

const FRONT: MatterKind[] = ["title-page", "copyright", "dedication", "epigraph", "foreword", "preface", "custom"];
const BACK: MatterKind[] = ["acknowledgments", "about-the-author", "also-by", "colophon", "custom"];

function kindLabel(kind: MatterKind): string {
  switch (kind) {
    case "title-page": return t`Title page`;
    case "copyright": return t`Copyright page`;
    case "dedication": return t`Dedication`;
    case "epigraph": return t`Epigraph`;
    case "foreword": return t`Foreword`;
    case "preface": return t`Preface`;
    case "custom": return t`Custom page`;
    case "acknowledgments": return t`Acknowledgments`;
    case "about-the-author": return t`About the author`;
    case "also-by": return t`Also by`;
    case "colophon": return t`Colophon`;
  }
}

/** Menu items with a tick: the mode switch, the layout toggles and the text formats that apply at the cursor. */
const TOGGLES = new Set([
  "view.write", "view.read", "view.focus", "view.details",
  "editor.bold", "editor.italic", "editor.underline", "editor.smallCaps", "editor.strike", "editor.code", "editor.superscript", "editor.subscript", "editor.codeBlock", "editor.h1", "editor.h2", "editor.h3", "editor.quote", "editor.bullets", "editor.numbers",
]);

export const FRONT_PRESET_IDS = FRONT.map((k) => `insert.front.${k}`);
export const BACK_PRESET_IDS = BACK.map((k) => `insert.back.${k}`);
/** Maximum recent projects listed in File > Open Recent. */
export const MENU_RECENTS = 8;

/**
 * The menu for the current context. The structure is fixed; what changes is which items are usable (a command that is not
 * registered, or registered as disabled, is greyed out), which toggles are ticked, and the labels that carry a name (Undo
 * says what it will undo, Open Recent lists the recent books).
 */
export function buildMenuModel(ctx: MenuContext): MenuEntry[] {
  const { commands } = ctx;
  const usable = (id: string) => commands[id] !== undefined && commands[id]!.enabled !== false;
  const cmd = (id: string, text: string, accelerator?: string, arg?: string): MenuEntry => ({
    kind: "command", id, text, enabled: usable(id),
    // Toggle items always carry a tick state, so their menu item keeps its type when the command appears or disappears.
    ...(TOGGLES.has(id) ? { checked: commands[id]?.checked ?? false } : {}),
    ...(accelerator ? { accelerator } : {}),
    ...(arg === undefined ? {} : { arg }),
  });
  const sep: MenuEntry = { kind: "separator" };
  const pre = (item: PredefinedKind, text?: string): MenuEntry => ({ kind: "predefined", item, ...(text ? { text } : {}) });
  const sub = (text: string, items: MenuEntry[]): MenuEntry => ({ kind: "submenu", text, items });

  const settings = cmd("app.settings", t`Settings…`, "CmdOrCtrl+,");

  const recent: MenuEntry[] = ctx.recents.slice(0, MENU_RECENTS).map((r) => ({ ...cmd("file.openRecent", r.title || r.root, undefined, r.root) }));
  const openRecent = sub(t`Open Recent`, recent.length ? [...recent, sep, cmd("file.clearRecents", t`Clear Menu`)] : [{ kind: "command", id: "file.none", text: t`No Recent Projects`, enabled: false }]);

  const app: MenuEntry = sub("CadabraCraft", [
    pre("About", t`About CadabraCraft`),
    sep,
    settings,
    sep,
    pre("Services", t`Services`),
    sep,
    pre("Hide", t`Hide CadabraCraft`),
    pre("HideOthers", t`Hide Others`),
    pre("ShowAll", t`Show All`),
    sep,
    pre("Quit", t`Quit CadabraCraft`),
  ]);

  const file = sub(t`File`, [
    cmd("file.new", t`New Project…`, "CmdOrCtrl+N"),
    cmd("file.open", t`Open Project…`, "CmdOrCtrl+O"),
    openRecent,
    cmd("file.import", t`Import Manuscript…`, "CmdOrCtrl+Shift+I"),
    sep,
    cmd("file.save", t`Save`, "CmdOrCtrl+S"),
    cmd("file.bookDetails", t`Book Details…`),
    sep,
    sub(t`Export`, [
      cmd("file.exportEpub", t`EPUB…`, "CmdOrCtrl+Alt+E"),
      cmd("file.exportPdf", t`Print PDF…`, "CmdOrCtrl+Shift+E"),
      cmd("file.exportMarkdown", t`Markdown…`),
      cmd("file.exportDocx", t`Word (.docx)…`),
      sep,
      cmd("file.printPreview", t`Print Preview…`),
    ]),
    sep,
    cmd("file.close", t`Close Project`, "CmdOrCtrl+Shift+W"),
    ...(ctx.mac ? [] : [sep, settings, sep, pre("Quit", t`Quit`)]),
  ]);

  const edit = sub(t`Edit`, [
    pre("Undo", t`Undo`),
    pre("Redo", t`Redo`),
    sep,
    pre("Cut", t`Cut`),
    pre("Copy", t`Copy`),
    pre("Paste", t`Paste`),
    pre("SelectAll", t`Select All`),
    sep,
    cmd("edit.find", t`Find…`, "CmdOrCtrl+F"),
    cmd("edit.findReplace", t`Find and Replace…`, "CmdOrCtrl+Alt+F"),
    sep,
    cmd("edit.convertHtml", t`Convert HTML in Selection to Styled Text`),
    sep,
    cmd("edit.bookUndo", ctx.undoLabel ? t`Undo ${ctx.undoLabel}` : t`Undo Chapter Change`),
    cmd("edit.bookRedo", ctx.redoLabel ? t`Redo ${ctx.redoLabel}` : t`Redo Chapter Change`),
  ]);

  const insert = sub(t`Insert`, [
    cmd("insert.chapter", t`New Chapter`, "CmdOrCtrl+Shift+N"),
    sub(t`Front Matter`, FRONT.map((k) => cmd(`insert.front.${k}`, kindLabel(k)))),
    sub(t`Back Matter`, BACK.map((k) => cmd(`insert.back.${k}`, kindLabel(k)))),
    sep,
    cmd("editor.sceneBreak", t`Scene Break`),
    cmd("editor.image", t`Image…`),
    cmd("editor.footnote", t`Footnote`),
    cmd("editor.link", t`Link…`),
    cmd("editor.codeBlock", t`Code Block`),
    cmd("editor.table", t`Table…`),
  ]);

  const format = sub(t`Format`, [
    cmd("editor.bold", t`Bold`),
    cmd("editor.italic", t`Italic`),
    cmd("editor.underline", t`Underline`),
    cmd("editor.smallCaps", t`Small Caps`),
    cmd("editor.strike", t`Strikethrough`),
    cmd("editor.code", t`Code`),
    cmd("editor.superscript", t`Superscript`),
    cmd("editor.subscript", t`Subscript`),
    sep,
    cmd("editor.h1", t`Heading 1`),
    cmd("editor.h2", t`Heading 2`),
    cmd("editor.h3", t`Heading 3`),
    sep,
    cmd("editor.quote", t`Block Quote`),
    cmd("editor.bullets", t`Bulleted List`),
    cmd("editor.numbers", t`Numbered List`),
    sep,
    sub(t`Table`, [
      cmd("editor.tableAddRow", t`Add Row Below`),
      cmd("editor.tableAddColumn", t`Add Column After`),
      cmd("editor.tableDeleteRow", t`Delete Row`),
      cmd("editor.tableDeleteColumn", t`Delete Column`),
      cmd("editor.tableHeaderRow", t`Toggle Header Row`),
      cmd("editor.tableDelete", t`Delete Table`),
    ]),
  ]);

  const view = sub(t`View`, [
    cmd("view.write", t`Write`),
    cmd("view.read", t`Read`),
    sep,
    cmd("view.focus", t`Focus Mode`, "CmdOrCtrl+Shift+F"),
    cmd("view.details", t`Details Panel`),
    sep,
    cmd("go.previous", t`Previous Page`, "CmdOrCtrl+["),
    cmd("go.next", t`Next Page`, "CmdOrCtrl+]"),
    sep,
    pre("Fullscreen", t`Enter Full Screen`),
  ]);

  const windowMenu = sub(t`Window`, [pre("Minimize", t`Minimize`), pre("Maximize", t`Zoom`), ...(ctx.mac ? [sep, pre("BringAllToFront", t`Bring All to Front`)] : []), sep, pre("CloseWindow", t`Close Window`)]);

  const help = sub(t`Help`, [cmd("help.updates", t`Check for Updates…`), sep, cmd("help.sponsor", t`Sponsor CadabraCraft…`)]);

  return [...(ctx.mac ? [app] : []), file, edit, insert, format, view, windowMenu, help];
}

/** Every command id the model refers to, in order. Used by tests to check that the structure and the registrations agree. */
export function commandIds(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((e) => (e.kind === "command" ? [e.id] : e.kind === "submenu" ? commandIds(e.items) : []));
}

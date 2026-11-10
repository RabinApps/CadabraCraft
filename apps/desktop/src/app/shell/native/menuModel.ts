import { t } from "@lingui/core/macro";
import type { MatterKind } from "@cadabracraft/shared";
import type { Commands } from "../../../state/app/commands";
import { acceleratorFromCombo, type Overrides } from "../../../lib/shortcutCombo";

/** What the native menu shows, as plain data. `nativeMenu.ts` turns it into the operating system's menu. */
export type PredefinedKind =
  | "Undo"
  | "Redo"
  | "Cut"
  | "Copy"
  | "Paste"
  | "SelectAll"
  | "Minimize"
  | "Maximize"
  | "Fullscreen"
  | "CloseWindow"
  | "Services"
  | "Hide"
  | "HideOthers"
  | "ShowAll"
  | "BringAllToFront"
  | "About";

export type MenuEntry =
  | {
      kind: "command";
      id: string;
      arg?: string;
      text: string;
      enabled: boolean;
      checked?: boolean;
      accelerator?: string;
    }
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
  /** The author's key changes (Settings > Shortcuts); a command that is not in it keeps the key written below. */
  shortcuts?: Overrides;
}

const FRONT: MatterKind[] = [
  "title-page",
  "copyright",
  "dedication",
  "epigraph",
  "contents",
  "foreword",
  "preface",
  "custom",
];
const BACK: MatterKind[] = ["acknowledgments", "about-the-author", "also-by", "colophon", "custom"];

function kindLabel(kind: MatterKind): string {
  switch (kind) {
    case "title-page":
      return t`Title page`;
    case "copyright":
      return t`Copyright page`;
    case "dedication":
      return t`Dedication`;
    case "epigraph":
      return t`Epigraph`;
    case "contents":
      return t`Contents`;
    case "foreword":
      return t`Foreword`;
    case "preface":
      return t`Preface`;
    case "custom":
      return t`Custom page`;
    case "blank":
      return t`Blank page`;
    case "acknowledgments":
      return t`Acknowledgments`;
    case "about-the-author":
      return t`About the author`;
    case "also-by":
      return t`Also by`;
    case "colophon":
      return t`Colophon`;
  }
}

/** Menu items with a tick: the mode switch, the layout toggles and the text formats that apply at the cursor. */
const TOGGLES = new Set([
  "view.write",
  "view.read",
  "view.focus",
  "view.typewriter",
  "view.details",
  "view.references",
  "editor.bold",
  "editor.italic",
  "editor.underline",
  "editor.smallCaps",
  "editor.strike",
  "editor.code",
  "editor.superscript",
  "editor.subscript",
  "editor.lang",
  "editor.codeBlock",
  "editor.h1",
  "editor.h2",
  "editor.h3",
  "editor.alignLeft",
  "editor.alignCenter",
  "editor.alignRight",
  "editor.alignDefault",
  "editor.quote",
  "editor.bullets",
  "editor.numbers",
  "editor.taskList",
  "editor.definitionList",
]);

export const FRONT_PRESET_IDS = FRONT.map((k) => `insert.front.${k}`);
export const BACK_PRESET_IDS = BACK.map((k) => `insert.back.${k}`);
/** Maximum recent projects listed in File > Open Recent. */
export const MENU_RECENTS = 8;

interface Builder {
  cmd: (id: string, text: string, defaultKey?: string, arg?: string) => MenuEntry;
  sep: MenuEntry;
  pre: (item: PredefinedKind, text: string) => MenuEntry;
  sub: (text: string, items: MenuEntry[]) => MenuEntry;
}

/** The small constructors the menus are written with, bound to the current commands and the author's key changes. */
function menuBuilder(ctx: MenuContext): Builder {
  const { commands } = ctx;
  const overrides = ctx.shortcuts ?? {};
  const usable = (id: string) => commands[id] !== undefined && commands[id]!.enabled !== false;
  // Only a command that has a key of its own can be moved; the author's choice replaces it (null removes it).
  const keyFor = (id: string, accelerator?: string): string | undefined => {
    const moved =
      accelerator !== undefined && Object.hasOwn(overrides, id) ? overrides[id] : undefined;
    return moved === undefined
      ? accelerator
      : moved === null
        ? undefined
        : acceleratorFromCombo(moved);
  };
  const cmd = (id: string, text: string, defaultKey?: string, arg?: string): MenuEntry => {
    const accelerator = keyFor(id, defaultKey);
    return {
      kind: "command",
      id,
      text,
      enabled: usable(id),
      // Toggle items always carry a tick state, so their menu item keeps its type when the command appears or disappears.
      ...(TOGGLES.has(id) ? { checked: commands[id]?.checked ?? false } : {}),
      ...(accelerator ? { accelerator } : {}),
      ...(arg === undefined ? {} : { arg }),
    };
  };
  const sep: MenuEntry = { kind: "separator" };
  const pre = (item: PredefinedKind, text: string): MenuEntry => ({
    kind: "predefined",
    item,
    text,
  });
  const sub = (text: string, items: MenuEntry[]): MenuEntry => ({ kind: "submenu", text, items });
  return { cmd, sep, pre, sub };
}

function appMenu(b: Builder, _ctx: MenuContext): MenuEntry {
  const { cmd, sep, pre, sub } = b;
  const settings = cmd("app.settings", t`Settings…`, "CmdOrCtrl+,");
  return sub("CadabraCraft", [
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
    cmd("app.quit", t`Quit CadabraCraft`, "CmdOrCtrl+Q"),
  ]);
}

function fileMenu(b: Builder, ctx: MenuContext): MenuEntry {
  const { cmd, sep, sub } = b;
  const settings = cmd("app.settings", t`Settings…`, "CmdOrCtrl+,");
  const recent: MenuEntry[] = ctx.recents
    .slice(0, MENU_RECENTS)
    .map((r) => ({ ...cmd("file.openRecent", r.title || r.root, undefined, r.root) }));
  const openRecent = sub(
    t`Open Recent`,
    recent.length
      ? [...recent, sep, cmd("file.clearRecents", t`Clear Menu`)]
      : [{ kind: "command", id: "file.none", text: t`No Recent Projects`, enabled: false }],
  );

  return sub(t`File`, [
    cmd("file.new", t`New project`, "CmdOrCtrl+N"),
    cmd("file.open", t`Open folder`, "CmdOrCtrl+O"),
    openRecent,
    cmd("file.library", t`Library…`),
    cmd("file.import", t`Import…`, "CmdOrCtrl+Shift+I"),
    cmd("file.importInto", t`Import into This Book…`),
    sep,
    cmd("file.save", t`Save`, "CmdOrCtrl+S"),
    cmd("file.bookDetails", t`Book Details…`),
    cmd("file.analysis", t`Analysis…`),
    cmd("file.writingHistory", t`Writing history…`),
    sep,
    sub(t`Export`, [
      cmd("file.exportEpub", t`EPUB…`, "CmdOrCtrl+Alt+E"),
      cmd("file.exportPdf", t`Print PDF…`, "CmdOrCtrl+Shift+E"),
      cmd("file.exportMarkdown", t`Markdown…`),
      cmd("file.exportDocx", t`Word (.docx)…`),
      cmd("file.exportRtf", t`Rich Text (.rtf)…`),
      cmd("file.exportAudiobook", t`Audiobook…`),
      sep,
      cmd("file.printPreview", t`Print Preview…`),
    ]),
    sep,
    cmd("file.close", t`Close Project`, "CmdOrCtrl+Shift+W"),
    ...(ctx.mac ? [] : [sep, settings, sep, cmd("app.quit", t`Quit`, "CmdOrCtrl+Q")]),
  ]);
}

function editMenu(b: Builder, ctx: MenuContext): MenuEntry {
  const { cmd, sep, pre, sub } = b;
  return sub(t`Edit`, [
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
}

function insertMenu(b: Builder, _ctx: MenuContext): MenuEntry {
  const { cmd, sep, sub } = b;
  return sub(t`Insert`, [
    cmd("insert.chapter", t`New Chapter`, "CmdOrCtrl+Shift+N"),
    cmd("insert.blank", t`Blank page`),
    sub(
      t`Front Matter`,
      FRONT.map((k) => cmd(`insert.front.${k}`, kindLabel(k))),
    ),
    sub(
      t`Back Matter`,
      BACK.map((k) => cmd(`insert.back.${k}`, kindLabel(k))),
    ),
    sep,
    cmd("editor.sceneBreak", t`Scene Break`),
    cmd("editor.pageBreak", t`Page break`),
    cmd("editor.image", t`Image…`),
    cmd("editor.footnote", t`Footnote`),
    // Not Shift+I: that is File > Import.
    cmd("editor.indexEntry", t`Index Entry…`, "CmdOrCtrl+Alt+X"),
    cmd("editor.glossaryTerm", t`Glossary Term…`, "CmdOrCtrl+Shift+G"),
    cmd("editor.link", t`Link…`),
    cmd("editor.codeBlock", t`Code Block`),
    cmd("editor.table", t`Table…`),
  ]);
}

function formatMenu(b: Builder, _ctx: MenuContext): MenuEntry {
  const { cmd, sep, sub } = b;
  return sub(t`Format`, [
    cmd("editor.bold", t`Bold`),
    cmd("editor.italic", t`Italic`),
    cmd("editor.underline", t`Underline`),
    cmd("editor.smallCaps", t`Small Caps`),
    cmd("editor.strike", t`Strikethrough`),
    cmd("editor.code", t`Code`),
    cmd("editor.superscript", t`Superscript`),
    cmd("editor.subscript", t`Subscript`),
    sep,
    cmd("editor.lang", t`Language of Selection…`),
    cmd("editor.clearLang", t`Clear Language`),
    sep,
    cmd("editor.h1", t`Heading 1`),
    cmd("editor.h2", t`Heading 2`),
    cmd("editor.h3", t`Heading 3`),
    sep,
    // A ticked item, not a radio group: the native menu API has no radio items, and the app untricks the other three.
    sub(t`Alignment`, [
      cmd("editor.alignLeft", t`Align to Start`),
      cmd("editor.alignCenter", t`Centre`),
      cmd("editor.alignRight", t`Align to End`),
      sep,
      cmd("editor.alignDefault", t`Template Default`),
    ]),
    sep,
    cmd("editor.quote", t`Block Quote`),
    cmd("editor.bullets", t`Bulleted List`),
    cmd("editor.numbers", t`Numbered List`),
    cmd("editor.taskList", t`Task List`),
    cmd("editor.definitionList", t`Definition List`),
    sep,
    sub(t`Table`, [
      cmd("editor.tableAddRow", t`Add Row Below`),
      cmd("editor.tableAddColumn", t`Add Column After`),
      cmd("editor.tableDeleteRow", t`Delete Row`),
      cmd("editor.tableDeleteColumn", t`Delete Column`),
      cmd("editor.tableHeaderRow", t`Toggle Header Row`),
      cmd("editor.tableDelete", t`Delete Table`),
    ]),
    sep,
    cmd("editor.convertQuotes", t`Convert Quotes and Dashes`),
  ]);
}

function viewMenu(b: Builder, _ctx: MenuContext): MenuEntry {
  const { cmd, sep, pre, sub } = b;
  return sub(t`View`, [
    cmd("view.write", t`Write`),
    cmd("view.read", t`Read`),
    sep,
    cmd("view.focus", t`Focus Mode`, "CmdOrCtrl+Shift+F"),
    cmd("view.typewriter", t`Typewriter Scrolling`, "CmdOrCtrl+Alt+T"),
    cmd("view.readAloud", t`Read Aloud from Cursor`),
    cmd("view.details", t`Details Panel`),
    cmd("view.references", t`References Panel`),
    cmd("view.board", t`Scene Board`),
    cmd("view.timeline", t`Timeline`),
    sep,
    cmd("view.palette", t`Command Palette…`, "CmdOrCtrl+K"),
    cmd("view.outline", t`Outline…`, "CmdOrCtrl+Shift+O"),
    sep,
    cmd("go.previous", t`Previous Page`, "CmdOrCtrl+["),
    cmd("go.next", t`Next Page`, "CmdOrCtrl+]"),
    sep,
    pre("Fullscreen", t`Enter Full Screen`),
  ]);
}

function windowMenu(b: Builder, ctx: MenuContext): MenuEntry {
  const { sep, pre, sub } = b;
  return sub(t`Window`, [
    pre("Minimize", t`Minimize`),
    pre("Maximize", t`Zoom`),
    ...(ctx.mac ? [sep, pre("BringAllToFront", t`Bring All to Front`)] : []),
    sep,
    pre("CloseWindow", t`Close Window`),
  ]);
}

function helpMenu(b: Builder, _ctx: MenuContext): MenuEntry {
  const { cmd, sep, sub } = b;
  return sub(t`Help`, [
    cmd("help.welcome", t`Welcome to CadabraCraft…`),
    sep,
    cmd("help.updates", t`Check for Updates…`),
    sep,
    cmd("help.sponsor", t`Sponsor CadabraCraft…`),
    cmd("help.licenses", t`Licenses…`),
  ]);
}

/**
 * The menu for the current context. The structure is fixed; what changes is which items are usable (a command that is not
 * registered, or registered as disabled, is greyed out), which toggles are ticked, and the labels that carry a name (Undo
 * says what it will undo, Open Recent lists the recent books).
 */
export function buildMenuModel(ctx: MenuContext): MenuEntry[] {
  const b = menuBuilder(ctx);
  return [
    ...(ctx.mac ? [appMenu(b, ctx)] : []),
    fileMenu(b, ctx),
    editMenu(b, ctx),
    insertMenu(b, ctx),
    formatMenu(b, ctx),
    viewMenu(b, ctx),
    windowMenu(b, ctx),
    helpMenu(b, ctx),
  ];
}

/** Every command id the model refers to, in order. Used by tests to check that the structure and the registrations agree. */
export function commandIds(entries: readonly MenuEntry[]): string[] {
  return entries.flatMap((e) =>
    e.kind === "command" ? [e.id] : e.kind === "submenu" ? commandIds(e.items) : [],
  );
}

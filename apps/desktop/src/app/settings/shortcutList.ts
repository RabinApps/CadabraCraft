import { t } from "@lingui/core/macro";
import { buildMenuModel, type MenuEntry, type PredefinedKind } from "../shell/native/menuModel";

/**
 * The list behind Settings > Shortcuts. One source of truth, two inputs:
 * - the menu model (`menuModel.ts`): every command with an accelerator, so a new menu shortcut shows up here by itself;
 * - the shortcuts that are not menu items: the editor's own keys (TipTap, listed in `EDITOR_SHORTCUTS`) and the window-wide keys
 *   (`useGlobalShortcuts`). `shortcutList.test.ts` fails when a key registered by the editor is missing from here.
 * Combos are written as `Mod+Alt+Shift+Key` (`Mod` is Command on macOS and Ctrl elsewhere) and turned into keycaps per platform.
 */

export type GroupId = "file" | "edit" | "insert" | "format" | "view" | "window" | "help";

export const GROUP_ORDER: readonly GroupId[] = [
  "file",
  "edit",
  "insert",
  "format",
  "view",
  "window",
  "help",
];

export interface Shortcut {
  id: string;
  group: GroupId;
  action: string;
  /** Alternatives that do the same thing (Redo: Shift+Mod+Z or Mod+Y). */
  combos: string[];
  /** Only exists on macOS (the system menu items). */
  macOnly?: boolean;
  /** The key cannot be changed: the system's own items and the structural keys (Tab, Escape, the line break). */
  fixed?: boolean;
}

/** One keycap: what it shows, and the words a search matches it by. */
export interface Key {
  label: string;
  /** What a screen reader says for it ("Command" for the symbol). */
  name: string;
  words: string[];
}

export interface ShortcutRow {
  id: string;
  group: GroupId;
  action: string;
  combos: Key[][];
  /** The author can give it another key. */
  rebindable: boolean;
}

export interface ShortcutGroup {
  group: GroupId;
  label: string;
  rows: ShortcutRow[];
}

export function groupLabel(group: GroupId): string {
  switch (group) {
    case "file":
      return t`File`;
    case "edit":
      return t`Edit`;
    case "insert":
      return t`Insert`;
    case "format":
      return t`Format`;
    case "view":
      return t`View`;
    case "window":
      return t`Window`;
    case "help":
      return t`Help`;
  }
}

/** The system menu items the menu model leaves without an accelerator (the operating system supplies it). */
const PREDEFINED_COMBOS: Partial<Record<PredefinedKind, { combo: string; macOnly?: boolean }>> = {
  Undo: { combo: "Mod+Z" },
  Redo: { combo: "Mod+Shift+Z" },
  Cut: { combo: "Mod+X" },
  Copy: { combo: "Mod+C" },
  Paste: { combo: "Mod+V" },
  SelectAll: { combo: "Mod+A" },
  Minimize: { combo: "Mod+M", macOnly: true },
  CloseWindow: { combo: "Mod+W", macOnly: true },
};

/** Further keys the system menu items answer to. */
const PREDEFINED_EXTRA: Partial<Record<PredefinedKind, string[]>> = { Redo: ["Mod+Y"] };

/** Menu accelerator (`CmdOrCtrl+Shift+I`) as a combo (`Mod+Shift+I`). */
export const comboFromAccelerator = (accelerator: string): string =>
  accelerator.replace(/CmdOrCtrl/g, "Mod");

const MODIFIERS = ["Mod", "Alt", "Shift"] as const;

/**
 * A TipTap / ProseMirror key name (`Shift-Mod-z`, `Mod-Alt-0`) as a combo, or null for keys that are not shown here (letters of
 * other alphabets that TipTap registers as aliases). Letters are upper-case, modifiers always in the same order.
 */
export function comboFromTiptapKey(key: string): string | null {
  const parts = key.split("-");
  const last = parts.pop() as string; // split always gives at least one part
  if (last === "" || /[^\u0020-\u007e]/.test(last)) return null;
  const mods = MODIFIERS.filter((m) => parts.includes(m));
  return [...mods, last.length === 1 ? last.toUpperCase() : last].join("+");
}

/**
 * Shortcuts that are not menu items (the editor's own keys and the window-wide ones).
 * Keys that act on structure only (Enter, Backspace, Delete, the arrows) are not listed; `IGNORED_EDITOR_KEYS` names them.
 */
export function editorShortcuts(): Shortcut[] {
  const s = (id: string, group: GroupId, action: string, ...combos: string[]): Shortcut => ({
    id,
    group,
    action,
    combos,
  });
  const fixed = (sh: Shortcut): Shortcut => ({ ...sh, fixed: true });
  return [
    s("editor.bold", "format", t`Bold`, "Mod+B"),
    s("editor.italic", "format", t`Italic`, "Mod+I"),
    s("editor.underline", "format", t`Underline`, "Mod+U"),
    s("editor.strike", "format", t`Strikethrough`, "Mod+Shift+S"),
    s("editor.code", "format", t`Code`, "Mod+E"),
    s("editor.paragraph", "format", t`Paragraph`, "Mod+Alt+0"),
    s("editor.h1", "format", t`Heading 1`, "Mod+Alt+1"),
    s("editor.h2", "format", t`Heading 2`, "Mod+Alt+2"),
    s("editor.h3", "format", t`Heading 3`, "Mod+Alt+3"),
    s("editor.alignLeft", "format", t`Align to Start`, "Mod+Shift+L"),
    s("editor.alignCenter", "format", t`Centre`, "Mod+Shift+C"),
    s("editor.alignRight", "format", t`Align to End`, "Mod+Shift+R"),
    s("editor.quote", "format", t`Block Quote`, "Mod+Shift+B"),
    s("editor.bullets", "format", t`Bulleted List`, "Mod+Shift+8"),
    s("editor.numbers", "format", t`Numbered List`, "Mod+Shift+7"),
    s("editor.codeBlock", "format", t`Code Block`, "Mod+Alt+C"),
    fixed(s("editor.indent", "format", t`Indent list item`, "Tab")),
    fixed(s("editor.outdent", "format", t`Outdent list item`, "Shift+Tab")),
    fixed(s("editor.lineBreak", "insert", t`Line break`, "Shift+Enter", "Mod+Enter")),
    s("book.undo", "edit", t`Undo book change`, "Mod+Alt+Z"),
    s("book.redo", "edit", t`Redo book change`, "Mod+Alt+Shift+Z"),
    fixed(s("focus.leave", "view", t`Leave Focus Mode`, "Escape")),
  ];
}

/**
 * Keys the editor registers that are deliberately not listed: they only act on the structure around the cursor (joining and
 * splitting blocks, moving in a table or a code block) and every writing app has them.
 */
export const IGNORED_EDITOR_KEYS: readonly string[] = [
  "Enter",
  "Backspace",
  "Delete",
  "Mod+Backspace",
  "Mod+Delete",
  "ArrowUp",
  "ArrowDown",
  "Tab",
  "Shift+Tab",
];

/** Walks one top-level menu and collects what has a key. `path` holds the submenu names below the top level. */
function fromMenu(
  entries: readonly MenuEntry[],
  group: GroupId,
  path: readonly string[],
): Shortcut[] {
  return entries.flatMap((e): Shortcut[] => {
    if (e.kind === "submenu") return fromMenu(e.items, group, [...path, e.text]);
    if (e.kind === "command" && e.accelerator) {
      const label = e.text.replace(/…$/, "");
      return [
        {
          id: e.id,
          group,
          action: [...path, label].join(" "),
          combos: [comboFromAccelerator(e.accelerator)],
        },
      ];
    }
    if (e.kind === "predefined") {
      const known = PREDEFINED_COMBOS[e.item];
      if (!known || !e.text) return [];
      return [
        {
          id: `system.${e.item}`,
          group,
          action: e.text,
          combos: [known.combo, ...(PREDEFINED_EXTRA[e.item] ?? [])],
          fixed: true,
          ...(known.macOnly ? { macOnly: true } : {}),
        },
      ];
    }
    return [];
  });
}

/** Every shortcut, grouped by menu in menu order, with the menu's own entries first inside each group. Language follows the active locale. */
export function buildShortcuts(): Shortcut[] {
  const menu = buildMenuModel({
    mac: false,
    commands: {},
    recents: [],
    undoLabel: null,
    redoLabel: null,
  });
  const fromMenus = menu.flatMap((top, i) =>
    top.kind === "submenu" ? fromMenu(top.items, GROUP_ORDER[i] ?? "help", []) : [],
  );
  const all = [...fromMenus, ...editorShortcuts()];
  return GROUP_ORDER.flatMap((g) => all.filter((s) => s.group === g));
}

const MAC_NAMES: Record<string, Key> = {
  Mod: { label: "⌘", name: "Command", words: ["cmd", "command"] },
  Alt: { label: "⌥", name: "Option", words: ["opt", "option", "alt"] },
  Shift: { label: "⇧", name: "Shift", words: ["shift"] },
};
const OTHER_NAMES: Record<string, Key> = {
  Mod: { label: "Ctrl", name: "Control", words: ["ctrl", "control"] },
  Alt: { label: "Alt", name: "Alt", words: ["alt"] },
  Shift: { label: "Shift", name: "Shift", words: ["shift"] },
};

const KEY_WORDS: Record<string, string[]> = {
  ",": ["comma"],
  "[": ["bracket"],
  "]": ["bracket"],
  Escape: ["esc", "escape"],
  Enter: ["enter", "return"],
  Tab: ["tab"],
};

function keyFor(part: string, mac: boolean): Key {
  const names = mac ? MAC_NAMES : OTHER_NAMES;
  const modifier = names[part];
  if (modifier) return modifier;
  const extra = KEY_WORDS[part] ?? [];
  if (part === "Escape") return { label: "Esc", name: "Escape", words: extra };
  if (part === "Enter") return { label: mac ? "↩" : "Enter", name: "Enter", words: extra };
  if (part === "Tab") return { label: mac ? "⇥" : "Tab", name: "Tab", words: extra };
  return { label: part, name: part, words: [part.toLowerCase(), ...extra] };
}

/** The keycaps for a combo. macOS writes modifiers as symbols in the system order (Option, Shift, Command) and then the key. */
export function keysFor(combo: string, mac: boolean): Key[] {
  // A combo's last part is the key; "+" never is one (the key "," and the brackets are, so splitting on "+" is safe).
  const parts = combo.split("+");
  const key = parts.pop() as string; // split always gives at least one part
  const mods = (mac ? ["Alt", "Shift", "Mod"] : ["Mod", "Alt", "Shift"]).filter((m) =>
    parts.includes(m),
  );
  return [...mods, key].map((p) => keyFor(p, mac));
}

/** The shortcuts of this platform as rows with their keycaps. */
export function shortcutRows(list: readonly Shortcut[], mac: boolean): ShortcutRow[] {
  return list
    .filter((s) => mac || !s.macOnly)
    .map((s) => ({
      id: s.id,
      group: s.group,
      action: s.action,
      combos: s.combos.map((c) => keysFor(c, mac)),
      rebindable: !s.fixed,
    }));
}

const keyMatches = (key: Key, part: string): boolean =>
  key.label.toLowerCase() === part || key.words.includes(part);

/**
 * Does a row answer the query? Words are separated by spaces and all have to match. A word matches the action name, or a key
 * (`cmd`, `shift`, `b`, a symbol); a word with plus signs (`cmd+shift+n`) has to match keys of one combo, in any order.
 */
export function rowMatches(row: ShortcutRow, query: string): boolean {
  const action = row.action.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      if (action.includes(word)) return true;
      const parts = word.split("+").filter(Boolean);
      return row.combos.some((keys) => parts.every((p) => keys.some((k) => keyMatches(k, p))));
    });
}

/** Rows grouped by area, without the groups that have no row left. An empty query keeps everything. */
export function groupRows(rows: readonly ShortcutRow[], query: string): ShortcutGroup[] {
  const q = query.trim();
  return GROUP_ORDER.map((group) => ({
    group,
    label: groupLabel(group),
    rows: rows.filter((r) => r.group === group && (q === "" || rowMatches(r, q))),
  })).filter((g) => g.rows.length > 0);
}

/** The keys of a combo as a spoken phrase: "Command Shift N". */
export const spokenCombo = (keys: readonly Key[]): string => keys.map((k) => k.name).join(" ");

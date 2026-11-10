import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenExtensions, getExtensionField, resolveExtensions } from "@tiptap/react";
import { EDITOR_KEY_COMMANDS, extensions } from "@cadabracraft/editor-schema";
import { Search } from "../../../editor/search/plugin";
import { Pagination } from "../../../editor/pagination/plugin";
import { buildMenuModel, commandIds, type MenuEntry } from "../../shell/native/menuModel";
import { isMac } from "../../../lib/platform";
import {
  GROUP_ORDER,
  IGNORED_EDITOR_KEYS,
  buildShortcuts,
  comboFromAccelerator,
  comboFromTiptapKey,
  groupRows,
  keysFor,
  rowMatches,
  shortcutRows,
  spokenCombo,
} from "../shortcutList";

const menu = (mac: boolean): MenuEntry[] =>
  buildMenuModel({ mac, commands: {}, recents: [], undoLabel: null, redoLabel: null });

function accelerators(entries: readonly MenuEntry[]): { id: string; accelerator: string }[] {
  return entries.flatMap((e) =>
    e.kind === "command" && e.accelerator
      ? [{ id: e.id, accelerator: e.accelerator }]
      : e.kind === "submenu"
        ? accelerators(e.items)
        : [],
  );
}

/** Every key the editor's extensions register (TipTap's own and ours), as combos. */
function registeredEditorCombos(): string[] {
  const all = flattenExtensions(
    resolveExtensions([...extensions, Search, Pagination] as never),
  ) as unknown as {
    name: string;
    options?: { levels?: number[] };
    storage?: unknown;
  }[];
  const combos = new Set<string>();
  for (const ext of all) {
    // Headings register one key per configured level; read the levels from the schema's configuration.
    const options = ext.name === "heading" ? { levels: [1, 2, 3] } : (ext.options ?? {});
    const field = getExtensionField<() => Record<string, unknown>>(
      ext as never,
      "addKeyboardShortcuts",
      { name: ext.name, options, storage: {}, editor: {}, type: null },
    );
    if (!field) continue;
    const keys = Object.keys(field());
    for (const key of keys) {
      const combo = comboFromTiptapKey(key);
      if (combo) combos.add(combo);
    }
  }
  return [...combos];
}

/** Editor commands with a key of their own that the app handles at window level (`useMarkDialogs`), not through TipTap. */
const WINDOW_LEVEL = ["editor.indexEntry", "editor.glossaryTerm"];

describe("the shortcut list", () => {
  const list = buildShortcuts();
  const listed = new Set(list.flatMap((s) => s.combos));

  it("contains every accelerator of the menu, on both platform layouts of the model", () => {
    for (const mac of [false, true]) {
      for (const { id, accelerator } of accelerators(menu(mac))) {
        const found = list.find((s) => s.id === id);
        expect(found, `${id} (${accelerator}) is missing from the shortcut list`).toBeDefined();
        expect(found!.combos).toContain(comboFromAccelerator(accelerator));
      }
    }
  });

  it("contains every key the editor registers, except the structural ones that are named as ignored", () => {
    const missing = registeredEditorCombos().filter(
      (c) => !listed.has(c) && !IGNORED_EDITOR_KEYS.includes(c),
    );
    expect(missing, `editor shortcuts missing from shortcutList.ts: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("does not list a key the editor does not have", () => {
    const editorOnly = list.filter(
      (s) => s.id.startsWith("editor.") && !WINDOW_LEVEL.includes(s.id),
    );
    const registered = new Set(registeredEditorCombos());
    for (const s of editorOnly)
      for (const c of s.combos) expect(registered.has(c), `${s.id} ${c}`).toBe(true);
  });

  it("can rebind exactly the editor keys that are not fixed, and the schema agrees with the list on the defaults", () => {
    const rebindable = list.filter(
      (s) => s.id.startsWith("editor.") && !s.fixed && !WINDOW_LEVEL.includes(s.id),
    );
    expect(rebindable.map((s) => s.id).sort()).toEqual(Object.keys(EDITOR_KEY_COMMANDS).sort());
    for (const s of rebindable)
      expect(s.combos, s.id).toEqual([comboFromTiptapKey(EDITOR_KEY_COMMANDS[s.id]!.key)]);
  });

  it("has unique ids, no combo used twice, and only known groups", () => {
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
    const all = list.flatMap((s) => s.combos);
    expect(new Set(all).size).toBe(all.length);
    for (const s of list) expect(GROUP_ORDER).toContain(s.group);
  });

  it("lists every command id with an accelerator in the menu model exactly once", () => {
    const withKeys = accelerators(menu(false)).map((a) => a.id);
    expect(new Set(withKeys).size).toBe(withKeys.length);
    expect(commandIds(menu(false)).length).toBeGreaterThan(withKeys.length);
  });

  it("hides the macOS-only system items elsewhere", () => {
    const names = (mac: boolean) => shortcutRows(list, mac).map((r) => r.action);
    expect(names(true)).toContain("Minimize");
    expect(names(false)).not.toContain("Minimize");
  });
});

describe("combos", () => {
  it("turns menu accelerators and TipTap keys into one notation", () => {
    expect(comboFromAccelerator("CmdOrCtrl+Shift+I")).toBe("Mod+Shift+I");
    expect(comboFromTiptapKey("Shift-Mod-z")).toBe("Mod+Shift+Z");
    expect(comboFromTiptapKey("Mod-b")).toBe("Mod+B");
    expect(comboFromTiptapKey("Mod-B")).toBe("Mod+B");
    expect(comboFromTiptapKey("Mod-Alt-0")).toBe("Mod+Alt+0");
    expect(comboFromTiptapKey("Mod-я")).toBeNull();
    expect(comboFromTiptapKey("Enter")).toBe("Enter");
  });

  it("writes macOS keycaps as symbols in the system order", () => {
    expect(keysFor("Mod+Alt+Shift+Z", true).map((k) => k.label)).toEqual(["⌥", "⇧", "⌘", "Z"]);
    expect(keysFor("Shift+Enter", true).map((k) => k.label)).toEqual(["⇧", "↩"]);
    expect(keysFor("Tab", true).map((k) => k.label)).toEqual(["⇥"]);
  });

  it("writes Windows and Linux keycaps as words", () => {
    expect(keysFor("Mod+Alt+Shift+Z", false).map((k) => k.label)).toEqual([
      "Ctrl",
      "Alt",
      "Shift",
      "Z",
    ]);
    expect(keysFor("Escape", false).map((k) => k.label)).toEqual(["Esc"]);
    expect(keysFor("Mod+,", false).map((k) => k.label)).toEqual(["Ctrl", ","]);
    expect(spokenCombo(keysFor("Mod+Shift+N", true))).toBe("Shift Command N");
    expect(spokenCombo(keysFor("Mod+Tab", false))).toBe("Control Tab");
  });
});

describe("filtering", () => {
  const rows = (mac: boolean) => shortcutRows(buildShortcuts(), mac);
  const actions = (query: string, mac = true) =>
    groupRows(rows(mac), query).flatMap((g) => g.rows.map((r) => r.action));

  it("keeps everything for an empty query and drops groups with no shortcut", () => {
    const groups = groupRows(rows(false), "  ");
    expect(groups.map((g) => g.group)).toEqual(["file", "edit", "insert", "format", "view"]);
    expect(groupRows(rows(true), "").map((g) => g.group)).toContain("window");
  });

  it("matches the action name, in any case", () => {
    expect(actions("BOLD")).toEqual(["Bold"]);
    expect(actions("heading")).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
  });

  it("matches keys by symbol, by name and by a combination in any order", () => {
    expect(actions("⌥⌘")).toEqual([]);
    expect(actions("⇧+⌘+n")).toContain("New Chapter");
    expect(actions("cmd+shift+n")).toEqual(["New Chapter"]);
    expect(actions("shift+cmd+n")).toEqual(["New Chapter"]);
    expect(actions("ctrl+shift+n", false)).toEqual(["New Chapter"]);
    expect(actions("ctrl+shift+n", true)).toEqual([]);
    expect(actions("option+z")).toEqual(["Undo book change", "Redo book change"]);
    expect(actions("esc")).toEqual(["Leave Focus Mode"]);
    expect(actions("cmd+comma")).toEqual(["Settings"]);
    // "comma" is also the start of the word "Command" in the palette's name.
    expect(actions("comma")).toEqual(["Settings", "Command Palette"]);
    expect(actions("cmd+k")).toEqual(["Command Palette"]);
    expect(actions("cmd+shift+o")).toEqual(["Outline"]);
  });

  it("needs every word to match", () => {
    expect(actions("bold italic")).toEqual([]);
    expect(actions("find cmd+alt")).toEqual(["Find and Replace"]);
  });

  it("matches the second alternative of a shortcut", () => {
    const redo = rows(false).find((r) => r.action === "Redo")!;
    expect(rowMatches(redo, "ctrl+y")).toBe(true);
    expect(rowMatches(redo, "ctrl+q")).toBe(false);
  });
});

describe("platform", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recognises macOS by the user agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    expect(isMac()).toBe(true);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" });
    expect(isMac()).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(isMac()).toBe(false);
  });
});

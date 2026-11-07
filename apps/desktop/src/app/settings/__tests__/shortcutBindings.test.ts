import { afterEach, describe, expect, it } from "vitest";
import { useSettings } from "../../../state/view/editorPrefs";
import { buildMenuModel, type MenuEntry } from "../../shell/native/menuModel";
import {
  applyOverrides,
  editorRemap,
  effectiveCombo,
  findConflict,
  pressed,
  withBinding,
  withoutBinding,
} from "../shortcutBindings";
import { buildShortcuts } from "../shortcutList";

afterEach(() => useSettings.getState().set({ shortcutOverrides: {} }));

const list = buildShortcuts();
const combosOf = (l: ReturnType<typeof buildShortcuts>, id: string) =>
  l.find((s) => s.id === id)?.combos;
const ev = (code: string, over: Partial<KeyboardEvent> = {}) =>
  ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  }) as KeyboardEvent;

describe("effectiveCombo", () => {
  it("is the default until the author changes it, then the choice, or null for no key", () => {
    expect(effectiveCombo("view.palette", {})).toBe("Mod+K");
    expect(effectiveCombo("view.palette", { "view.palette": "Mod+J" })).toBe("Mod+J");
    expect(effectiveCombo("view.palette", { "view.palette": null })).toBeNull();
    expect(effectiveCombo("no.such.command", {})).toBeNull();
    // Only an own entry counts, not the object prototype.
    expect(effectiveCombo("constructor", {})).toBeNull();
  });
  it("reads the stored choice when a key is pressed", () => {
    const k = ev("KeyK", { metaKey: true });
    expect(pressed(k, "view.palette")).toBe(true);
    useSettings.getState().set({ shortcutOverrides: { "view.palette": "Mod+J" } });
    expect(pressed(k, "view.palette")).toBe(false);
    expect(pressed(ev("KeyJ", { ctrlKey: true }), "view.palette")).toBe(true);
  });
});

describe("applyOverrides", () => {
  it("replaces a command's keys, removes them for null and leaves fixed shortcuts alone", () => {
    const out = applyOverrides(list, {
      "editor.bold": "Mod+Alt+J",
      "file.new": null,
      "system.Copy": "Mod+J",
      "focus.leave": "Mod+J",
      "unknown.id": "Mod+J",
    });
    expect(combosOf(out, "editor.bold")).toEqual(["Mod+Alt+J"]);
    expect(combosOf(out, "file.new")).toEqual([]);
    expect(combosOf(out, "system.Copy")).toEqual(["Mod+C"]);
    expect(combosOf(out, "focus.leave")).toEqual(["Escape"]);
    expect(out).toHaveLength(list.length);
  });
  it("marks the system items and the structural keys as fixed", () => {
    const fixed = list.filter((s) => s.fixed).map((s) => s.id);
    expect(fixed).toEqual(
      expect.arrayContaining([
        "system.Undo",
        "system.Copy",
        "editor.indent",
        "editor.outdent",
        "editor.lineBreak",
        "focus.leave",
      ]),
    );
    expect(fixed).not.toContain("editor.bold");
    expect(fixed).not.toContain("file.save");
  });
});

describe("findConflict", () => {
  it("names the shortcut that already has the key", () => {
    expect(findConflict(list, "editor.bold", "Mod+I", false)).toEqual({
      kind: "shortcut",
      action: "Italic",
    });
    expect(findConflict(list, "editor.bold", "Mod+Z", false)).toEqual({
      kind: "shortcut",
      action: "Undo",
    });
  });
  it("accepts a free key and the command's own key", () => {
    expect(findConflict(list, "editor.bold", "Mod+Alt+J", false)).toBeNull();
    expect(findConflict(list, "editor.bold", "Mod+B", false)).toBeNull();
  });
  it("sees a key that was freed by another change", () => {
    const moved = applyOverrides(list, { "editor.italic": "Mod+Alt+J" });
    expect(findConflict(moved, "editor.bold", "Mod+I", false)).toBeNull();
    expect(findConflict(moved, "editor.bold", "Mod+Alt+J", false)).toEqual({
      kind: "shortcut",
      action: "Italic",
    });
  });
  it("counts the macOS-only system items on macOS only", () => {
    expect(findConflict(list, "editor.bold", "Mod+M", true)).toEqual({
      kind: "shortcut",
      action: "Minimize",
    });
    expect(findConflict(list, "editor.bold", "Mod+M", false)).toBeNull();
  });
  it("keeps the keys of the system and of the text structure", () => {
    expect(findConflict(list, "editor.bold", "Mod+H", false)).toEqual({ kind: "reserved" });
    expect(findConflict(list, "editor.bold", "F11", false)).toEqual({ kind: "reserved" });
    expect(findConflict(list, "editor.bold", "Mod+Backspace", false)).toEqual({
      kind: "reserved",
    });
  });
});

describe("editing the overrides", () => {
  it("sets a key, and drops the entry when the key is the default again", () => {
    expect(withBinding({}, "editor.bold", "Mod+Alt+J")).toEqual({ "editor.bold": "Mod+Alt+J" });
    expect(withBinding({ "editor.bold": "Mod+Alt+J" }, "editor.bold", "Mod+B")).toEqual({});
    expect(withBinding({ "editor.bold": "Mod+B" }, "editor.bold", null)).toEqual({
      "editor.bold": null,
    });
  });
  it("resets one command and leaves the others", () => {
    expect(withoutBinding({ a: "Mod+J", b: null }, "a")).toEqual({ b: null });
  });
  it("lists only the editor commands for the editor, as ProseMirror keys", () => {
    expect(
      editorRemap({ "editor.bold": "Mod+Alt+J", "editor.italic": null, "file.new": "Mod+J" }),
    ).toEqual({ "editor.bold": "Mod-Alt-j", "editor.italic": null });
  });
});

describe("the menu follows the overrides", () => {
  const accel = (entries: readonly MenuEntry[], id: string): string | undefined | "missing" => {
    for (const e of entries) {
      if (e.kind === "command" && e.id === id) return e.accelerator;
      if (e.kind === "submenu") {
        const r = accel(e.items, id);
        if (r !== "missing") return r;
      }
    }
    return "missing";
  };
  const menu = (shortcuts: Record<string, string | null>) =>
    buildMenuModel({
      mac: false,
      commands: {},
      recents: [],
      undoLabel: null,
      redoLabel: null,
      shortcuts,
    });

  it("keeps the default without overrides, moves a key, and removes it for null", () => {
    expect(accel(menu({}), "file.new")).toBe("CmdOrCtrl+N");
    expect(accel(menu({ "file.new": "Mod+Alt+J" }), "file.new")).toBe("CmdOrCtrl+Alt+J");
    expect(accel(menu({ "file.new": null }), "file.new")).toBeUndefined();
  });
  it("gives a key only to commands that had one (editor keys belong to the editor)", () => {
    expect(accel(menu({ "editor.bold": "Mod+Alt+J" }), "editor.bold")).toBeUndefined();
    expect(accel(menu({ "file.exportMarkdown": "Mod+J" }), "file.exportMarkdown")).toBeUndefined();
  });
});

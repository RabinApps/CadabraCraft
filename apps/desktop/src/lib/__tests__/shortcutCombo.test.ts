import { describe, expect, it } from "vitest";
import {
  acceleratorFromCombo,
  captureKey,
  cleanOverrides,
  comboFromEvent,
  comboProblem,
  eventMatches,
  isBindable,
  keyFromCode,
  proseMirrorKey,
} from "../shortcutCombo";

const ev = (code: string, over: Partial<KeyboardEvent> = {}) =>
  ({
    code,
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...over,
  }) as KeyboardEvent;

describe("keyFromCode", () => {
  it("names letters, digits, function keys and punctuation by the physical key", () => {
    expect(keyFromCode("KeyK")).toBe("K");
    expect(keyFromCode("Digit7")).toBe("7");
    expect(keyFromCode("F12")).toBe("F12");
    expect(keyFromCode("F13")).toBeNull();
    expect(keyFromCode("Comma")).toBe(",");
    expect(keyFromCode("BracketLeft")).toBe("[");
  });
  it("has no name for keys that cannot be bound", () => {
    for (const code of ["Enter", "Tab", "ArrowUp", "ShiftLeft", "Space", "Numpad1", ""])
      expect(keyFromCode(code)).toBeNull();
  });
});

describe("combos from key events", () => {
  it("writes modifiers in the fixed order, Command and Ctrl both as Mod", () => {
    expect(comboFromEvent(ev("KeyZ", { metaKey: true, altKey: true, shiftKey: true }))).toBe(
      "Mod+Alt+Shift+Z",
    );
    expect(comboFromEvent(ev("KeyK", { ctrlKey: true }))).toBe("Mod+K");
    expect(comboFromEvent(ev("KeyK"))).toBe("K");
    expect(comboFromEvent(ev("Enter", { ctrlKey: true }))).toBeNull();
  });
  it("matches an event against a combo, never against no key", () => {
    expect(eventMatches(ev("KeyK", { metaKey: true }), "Mod+K")).toBe(true);
    expect(eventMatches(ev("KeyK", { metaKey: true, shiftKey: true }), "Mod+K")).toBe(false);
    expect(eventMatches(ev("KeyK", { metaKey: true }), null)).toBe(false);
  });
  it("never treats AltGr (which types a character on many layouts) as a shortcut", () => {
    const altGr = {
      ...ev("KeyE", { ctrlKey: true, altKey: true }),
      getModifierState: (k: string) => k === "AltGraph",
    };
    expect(eventMatches(altGr, "Mod+Alt+E")).toBe(false);
    const alt = { ...ev("KeyE", { ctrlKey: true, altKey: true }), getModifierState: () => false };
    expect(eventMatches(alt, "Mod+Alt+E")).toBe(true);
  });
});

describe("what can be bound", () => {
  it("needs Mod or Alt, or is a function key", () => {
    for (const ok of ["Mod+B", "Alt+B", "Mod+Alt+Shift+Z", "F5", "Shift+F5", "Mod+,", "Mod+["])
      expect(isBindable(ok), ok).toBe(true);
    for (const bad of ["B", "Shift+B", "Mod+Enter", "Alt+Mod+B", "Mod+Mod+B", "Mod+b", "", "Mod+"])
      expect(isBindable(bad), bad).toBe(false);
    expect(isBindable(5)).toBe(false);
    expect(isBindable(null)).toBe(false);
  });
  it("tells a missing modifier from a key that is no key at all", () => {
    expect(comboProblem("Shift+B")).toBe("needs-modifier");
    expect(comboProblem("B")).toBe("needs-modifier");
    expect(comboProblem("Mod+B")).toBeNull();
    expect(comboProblem("Mod+Enter")).toBeNull();
  });
});

describe("combo formats", () => {
  it("turns a combo into the native accelerator and the ProseMirror key", () => {
    expect(acceleratorFromCombo("Mod+Shift+K")).toBe("CmdOrCtrl+Shift+K");
    expect(acceleratorFromCombo("Alt+K")).toBe("Alt+K");
    expect(proseMirrorKey("Mod+Alt+Shift+K")).toBe("Mod-Alt-Shift-k");
    expect(proseMirrorKey("Mod+7")).toBe("Mod-7");
    expect(proseMirrorKey("Alt+F5")).toBe("Alt-F5");
  });
});

describe("captureKey", () => {
  it("ignores modifiers on their own and text composition", () => {
    expect(captureKey(ev("ShiftLeft", { key: "Shift" })).kind).toBe("ignore");
    expect(captureKey(ev("KeyA", { key: "a", isComposing: true })).kind).toBe("ignore");
  });
  it("cancels on Escape and clears on a bare Backspace or Delete", () => {
    expect(captureKey(ev("Escape", { key: "Escape" })).kind).toBe("cancel");
    expect(captureKey(ev("Backspace", { key: "Backspace" })).kind).toBe("clear");
    expect(captureKey(ev("Delete", { key: "Delete" })).kind).toBe("clear");
    expect(captureKey(ev("Backspace", { key: "Backspace", ctrlKey: true })).kind).toBe("none");
  });
  it("returns the combo, or none for a key that cannot be bound", () => {
    expect(captureKey(ev("KeyB", { key: "b", metaKey: true }))).toEqual({
      kind: "combo",
      combo: "Mod+B",
    });
    expect(captureKey(ev("Tab", { key: "Tab" })).kind).toBe("none");
  });
});

describe("cleanOverrides", () => {
  it("keeps good entries, including null (no key)", () => {
    expect(cleanOverrides({ "editor.bold": "Mod+Alt+J", "view.focus": null })).toEqual({
      "editor.bold": "Mod+Alt+J",
      "view.focus": null,
    });
  });
  it("drops what is not a command id, a bindable combo or null", () => {
    expect(
      cleanOverrides({
        "": "Mod+J",
        __proto__: "Mod+J",
        "has space": "Mod+J",
        a: "J",
        b: 5,
        c: undefined,
        d: "Mod+Q+X",
      }),
    ).toEqual({});
  });
  it("treats anything that is not a plain object as no changes", () => {
    for (const v of [null, undefined, 3, "x", [], [["a", "Mod+J"]], true])
      expect(cleanOverrides(v)).toEqual({});
  });
  it("keeps at most 200 entries", () => {
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`cmd.x${i}`, "Mod+J"]));
    expect(Object.keys(cleanOverrides(many))).toHaveLength(200);
  });
});

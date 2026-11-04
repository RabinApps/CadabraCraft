import { describe, expect, it } from "vitest";
import { EDITOR_KEY_COMMANDS, shortcutRemap } from "../index";

type Keys = Record<string, () => boolean>;

/** The key handlers the remap extension registers, with an editor that records the command it is asked to run. */
function keysFor(remap: Record<string, string | null>) {
  const calls: string[] = [];
  const editor = {
    commands: new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          (arg?: unknown): boolean => {
            calls.push(arg === undefined ? name : `${name}:${JSON.stringify(arg)}`);
            return true;
          },
      },
    ),
  };
  const ext = shortcutRemap(remap) as unknown as {
    config: { addKeyboardShortcuts: (this: unknown) => Keys; priority: number };
  };
  return { keys: ext.config.addKeyboardShortcuts.call({ editor }), calls, ext };
}

describe("shortcutRemap", () => {
  it("runs ahead of StarterKit", () => {
    expect(keysFor({}).ext.config.priority).toBeGreaterThan(100);
  });

  it("registers nothing without overrides and ignores unknown ids", () => {
    expect(Object.keys(keysFor({}).keys)).toEqual([]);
    expect(Object.keys(keysFor({ "nope.bold": "Mod-j" }).keys)).toEqual([]);
  });

  it("swallows the default key (and its Caps Lock twin) and runs the command on the new key", () => {
    const { keys, calls } = keysFor({ "editor.bold": "Mod-Alt-j" });
    expect(keys["Mod-b"]!()).toBe(true);
    expect(keys["Mod-B"]!()).toBe(true);
    expect(calls).toEqual([]);
    expect(keys["Mod-Alt-j"]!()).toBe(true);
    expect(keys["Mod-Alt-J"]!()).toBe(true);
    expect(calls).toEqual(["toggleBold", "toggleBold"]);
  });

  it("unbinds with null and lets a command take another command's freed key", () => {
    const { keys, calls } = keysFor({ "editor.bold": null, "editor.italic": "Mod-b" });
    expect(Object.keys(keys)).toEqual(expect.arrayContaining(["Mod-b", "Mod-i"]));
    keys["Mod-b"]!();
    expect(calls).toEqual(["toggleItalic"]);
    // Keys without a letter at the end have no twin.
    expect(Object.keys(keysFor({ "editor.h1": "Mod-Alt-4" }).keys).sort()).toEqual([
      "Mod-Alt-1",
      "Mod-Alt-4",
    ]);
  });

  it("knows what every editor key does", () => {
    const expected: Record<string, string> = {
      "editor.bold": "toggleBold",
      "editor.italic": "toggleItalic",
      "editor.underline": "toggleUnderline",
      "editor.strike": "toggleStrike",
      "editor.code": "toggleCode",
      "editor.paragraph": "setParagraph",
      "editor.h1": 'toggleHeading:{"level":1}',
      "editor.h2": 'toggleHeading:{"level":2}',
      "editor.h3": 'toggleHeading:{"level":3}',
      "editor.quote": "toggleBlockquote",
      "editor.bullets": "toggleBulletList",
      "editor.numbers": "toggleOrderedList",
      "editor.codeBlock": "toggleCodeBlock",
      "editor.alignLeft": 'setTextAlign:"start"',
      "editor.alignCenter": 'setTextAlign:"center"',
      "editor.alignRight": 'setTextAlign:"end"',
    };
    expect(Object.keys(EDITOR_KEY_COMMANDS).sort()).toEqual(Object.keys(expected).sort());
    for (const [id, call] of Object.entries(expected)) {
      const { keys, calls } = keysFor({ [id]: "F9" });
      keys["F9"]!();
      expect(calls).toEqual([call]);
    }
  });
});

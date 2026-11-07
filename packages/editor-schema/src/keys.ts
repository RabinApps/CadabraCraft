import { Extension, type Editor } from "@tiptap/core";

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
  "editor.alignLeft": { key: "Mod-Shift-l", run: (e) => e.commands.setTextAlign("start") },
  // C, not E: Mod+Shift+E is Print PDF in the menu (a menu accelerator wins the key before the editor sees it).
  "editor.alignCenter": { key: "Mod-Shift-c", run: (e) => e.commands.setTextAlign("center") },
  "editor.alignRight": { key: "Mod-Shift-r", run: (e) => e.commands.setTextAlign("end") },
};

/** A key with its Caps Lock twin: ProseMirror names a letter by the character it types, so `Mod-b` and `Mod-B` are two keys. */
export const withCase = (key: string): string[] => {
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

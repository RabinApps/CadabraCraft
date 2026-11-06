import { eventMatches, proseMirrorKey, type Overrides } from "../../lib/shortcutCombo";
import { useSettings } from "../../state/view/editorPrefs";
import { buildShortcuts, IGNORED_EDITOR_KEYS, type Shortcut } from "./shortcutList";

/**
 * Rebinding on top of the shortcut list. The list (`shortcutList.ts`) holds the defaults; the author's changes are
 * `Overrides` (command id to combo, or null for no key) kept in the preferences. Everything that reacts to a key asks here:
 * `applyOverrides` for the list the settings page shows, `effectiveCombo` for the window-level key handlers, `findConflict`
 * before a new key is accepted.
 */

/** Keys the app must not take over besides those the list already names: hiding the app (macOS) and full screen. */
const OS_RESERVED: readonly string[] = ["Mod+H", "Mod+Alt+H", "F11"];
const RESERVED = new Set([...IGNORED_EDITOR_KEYS, ...OS_RESERVED]);

let defaults: ReadonlyMap<string, string | undefined> | null = null;
/** The default combo of every command (the first one, for the commands that have several). The language does not matter here. */
const defaultCombo = (id: string): string | undefined => {
  defaults ??= new Map(buildShortcuts().map((s) => [s.id, s.combos[0]]));
  return defaults.get(id);
};

/** The combo a command answers to now: the author's choice, else its default. Null when it has no key. */
export function effectiveCombo(id: string, overrides: Overrides): string | null {
  if (Object.hasOwn(overrides, id)) return overrides[id] ?? null;
  return defaultCombo(id) ?? null;
}

/** Does a key event press this command's key? Reads the stored choice at the moment of the key, so a change applies at once. */
export const pressed = (e: KeyboardEvent, id: string): boolean =>
  eventMatches(e, effectiveCombo(id, useSettings.getState().shortcutOverrides));

/** The list with the author's changes applied. Fixed shortcuts and unknown ids are left alone. */
export const applyOverrides = (list: readonly Shortcut[], overrides: Overrides): Shortcut[] =>
  list.map((s) =>
    s.fixed || !Object.hasOwn(overrides, s.id)
      ? s
      : { ...s, combos: overrides[s.id] ? [overrides[s.id]!] : [] },
  );

export type Conflict = { kind: "shortcut"; action: string } | { kind: "reserved" };

/** What already uses `combo` (another shortcut of this platform, or a key the system or the editor keeps), or null when it is free. */
export function findConflict(
  list: readonly Shortcut[],
  id: string,
  combo: string,
  mac: boolean,
): Conflict | null {
  const other = list.find((s) => s.id !== id && (mac || !s.macOnly) && s.combos.includes(combo));
  if (other) return { kind: "shortcut", action: other.action };
  return RESERVED.has(combo) ? { kind: "reserved" } : null;
}

/** The overrides with `id` set to `combo` (a key, or null for none); a key equal to the default removes the entry. */
export function withBinding(overrides: Overrides, id: string, combo: string | null): Overrides {
  const { [id]: _old, ...rest } = overrides;
  return combo !== null && combo === defaultCombo(id) ? rest : { ...rest, [id]: combo };
}

/** The overrides without `id` (back to its default). */
export const withoutBinding = (overrides: Overrides, id: string): Overrides => {
  const { [id]: _old, ...rest } = overrides;
  return rest;
};

/** The ProseMirror key names for the editor commands the author moved, for `shortcutRemap` in the editor schema. */
export const editorRemap = (overrides: Overrides): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(overrides)
      .filter(([id]) => id.startsWith("editor."))
      .map(([id, combo]) => [id, combo === null ? null : proseMirrorKey(combo)]),
  );

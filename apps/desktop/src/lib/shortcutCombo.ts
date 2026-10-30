/**
 * Key combos as the Shortcuts settings store and match them. A combo is `Mod+Alt+Shift+Key` (`Mod` is Command on macOS and Ctrl
 * elsewhere), always in that modifier order, with one key: a letter (upper case), a digit, one of the punctuation keys below or F1..F12.
 * Pure data and functions, so the menu model, the window key handlers and the settings page share one reading of a combo.
 */

/** Per-user key changes: a command id maps to its new combo, or to null when the author removed its key. Absent means the default. */
export type Overrides = Readonly<Record<string, string | null>>;

const PUNCTUATION: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};
const PUNCTUATION_KEYS = new Set(Object.values(PUNCTUATION));
const MODIFIER_ORDER = ["Mod", "Alt", "Shift"] as const;

/** The key a physical key stands for (layout independent, so Option+K on a Mac is K), or null for keys that cannot be bound. */
export function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  const f = /^F([1-9]|1[0-2])$/.exec(code);
  if (f) return code;
  return PUNCTUATION[code] ?? null;
}

const isKey = (key: string): boolean =>
  /^[A-Z0-9]$/.test(key) || PUNCTUATION_KEYS.has(key) || /^F([1-9]|1[0-2])$/.test(key);

/** The parts of a combo, or null when it is not in the canonical `Mod+Alt+Shift+Key` form with a bindable key. */
function parse(combo: string): { mods: string[]; key: string } | null {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  if (!isKey(key)) return null;
  const mods = MODIFIER_ORDER.filter((m) => parts.includes(m));
  // Canonical only: every part is a known modifier, none repeated, in order.
  return mods.length === parts.length && mods.every((m, i) => parts[i] === m)
    ? { mods, key }
    : null;
}

/** Is this a combo the settings can store: well formed, and with Mod or Alt (or a function key), so it cannot be typed as text. */
export function isBindable(combo: unknown): combo is string {
  if (typeof combo !== "string") return false;
  const p = parse(combo);
  return p !== null && (p.mods.includes("Mod") || p.mods.includes("Alt") || /^F\d/.test(p.key));
}

/** Why a well-formed combo cannot be bound, or null. Only the missing modifier is a problem the author can fix. */
export const comboProblem = (combo: string): "needs-modifier" | null => {
  const p = parse(combo);
  return p && !isBindable(combo) ? "needs-modifier" : null;
};

/** The combo a key event stands for, or null for a key that cannot be bound (a modifier on its own, arrows, Enter...). */
export function comboFromEvent(
  e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): string | null {
  const key = keyFromCode(e.code);
  if (!key) return null;
  return [
    ...(e.metaKey || e.ctrlKey ? ["Mod"] : []),
    ...(e.altKey ? ["Alt"] : []),
    ...(e.shiftKey ? ["Shift"] : []),
    key,
  ].join("+");
}

/**
 * Does this key event press `combo`? A null combo (no key) never matches. AltGr (Ctrl+Alt on Windows and Linux) types a character on
 * many layouts (² € ć), so an event with AltGraph down is text, never a shortcut.
 */
export const eventMatches = (
  e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
    getModifierState?: (key: string) => boolean;
  },
  combo: string | null,
): boolean => combo !== null && !e.getModifierState?.("AltGraph") && comboFromEvent(e) === combo;

/** The native menu's accelerator for a combo (`Mod+Shift+K` is `CmdOrCtrl+Shift+K`). */
export const acceleratorFromCombo = (combo: string): string => combo.replace(/^Mod\b/, "CmdOrCtrl");

/** The ProseMirror key name for a combo (`Mod+Alt+K` is `Mod-Alt-k`). */
export const proseMirrorKey = (combo: string): string => {
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  return [...parts, key.length === 1 ? key.toLowerCase() : key].join("-");
};

export const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

/** What a pressed key means while a row waits for its new key. */
export type Captured =
  | { kind: "cancel" }
  | { kind: "clear" }
  | { kind: "combo"; combo: string }
  | { kind: "none" }
  | { kind: "ignore" };

/** Reads a key event the way the page records it: Esc cancels, Backspace removes the key, a bindable key is a combo. */
export function captureKey(e: KeyboardEvent): Captured {
  if (e.isComposing || MODIFIER_KEYS.has(e.key)) return { kind: "ignore" };
  const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
  if (e.key === "Escape") return { kind: "cancel" };
  if (bare && (e.key === "Backspace" || e.key === "Delete")) return { kind: "clear" };
  const combo = comboFromEvent(e);
  return combo ? { kind: "combo", combo } : { kind: "none" };
}

const MAX_OVERRIDES = 200;
const ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

/** Stored overrides, keeping only well-formed entries (a valid id and a bindable combo or null); anything else is dropped. */
export function cleanOverrides(v: unknown): Overrides {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  return Object.fromEntries(
    Object.entries(v)
      .filter(([id, combo]) => ID.test(id) && (combo === null || isBindable(combo)))
      .slice(0, MAX_OVERRIDES),
  ) as Overrides;
}

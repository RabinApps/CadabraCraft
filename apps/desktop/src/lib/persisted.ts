import { create, type StoreApi, type UseBoundStore } from "zustand";

/**
 * App preferences live in localStorage, which can be missing, full or blocked (private windows, tests). Every read and
 * write goes through these helpers so that never throws: a failed read is "nothing stored", a failed write keeps the value in memory.
 */

/** The stored text, or null when nothing is stored or storage is unavailable. */
export function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** The stored JSON value, or null when nothing (valid) is stored or storage is unavailable. */
export function readStoredJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}

export function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep it in memory for this session */ }
}

export function removeStored(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage unavailable: keep it in memory for this session */ }
}

export type PersistedStore<P extends object> = UseBoundStore<StoreApi<P & { set: (p: Partial<P>) => void }>>;

interface PersistedOptions<P extends object> {
  /** The localStorage key. */
  key: string;
  defaults: P;
  /** Turns the stored JSON into preferences, or null when it is missing, corrupt or from an unknown shape (the defaults are used). */
  parse: (stored: unknown) => P | null;
  /** Applied to every update before it is stored, e.g. clamping a number. */
  clean?: (next: P) => P;
}

/**
 * A zustand store of preferences kept in localStorage as JSON: read once at start (falling back to `defaults`),
 * and written on every `set(partial)`. App preference only; never stored in project files.
 */
export function createPersistedStore<P extends object>({ key, defaults, parse, clean = (p) => p }: PersistedOptions<P>): PersistedStore<P> {
  const initial = parse(readStoredJson(key)) ?? defaults;
  return create<P & { set: (p: Partial<P>) => void }>((set, get) => ({
    ...initial,
    set: (partial) => {
      const { set: _set, ...current } = get();
      const next = clean({ ...(current as unknown as P), ...partial });
      writeStored(key, JSON.stringify(next));
      set(next);
    },
  }));
}

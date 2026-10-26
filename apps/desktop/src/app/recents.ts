import { create } from "zustand";

const KEY = "cadabracraft.recents";
export const MAX_RECENTS = 8;

export interface Recent { root: string; title: string; openedAt: number }

/** Move (or add) a project to the front, replacing any entry for the same folder, and cap the list. */
export function addRecent(list: Recent[], entry: Recent, max = MAX_RECENTS): Recent[] {
  return [entry, ...list.filter((r) => r.root !== entry.root)].slice(0, max);
}

export function removeRecent(list: Recent[], root: string): Recent[] {
  return list.filter((r) => r.root !== root);
}

/** Tolerant parse of the stored value: drops malformed entries and duplicates, never throws. */
export function parseRecents(raw: string | null, max = MAX_RECENTS): Recent[] {
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(v)) return [];
    const out: Recent[] = [];
    for (const e of v) {
      if (e && typeof e.root === "string" && e.root !== "" && typeof e.title === "string" && Number.isFinite(e.openedAt) && !out.some((r) => r.root === e.root)) {
        out.push({ root: e.root, title: e.title, openedAt: e.openedAt });
      }
    }
    return out.slice(0, max);
  } catch { return []; }
}

function read(): Recent[] {
  try { return parseRecents(localStorage.getItem(KEY)); } catch { return []; }
}

function write(list: Recent[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable: keep in memory */ }
}

/** Recently opened projects. App preference only: absolute paths live here, never in project files. */
export const useRecents = create<{ recents: Recent[]; add: (root: string, title: string) => void; remove: (root: string) => void; clear: () => void }>((set, get) => ({
  recents: read(),
  add: (root, title) => { const next = addRecent(get().recents, { root, title, openedAt: Date.now() }); write(next); set({ recents: next }); },
  remove: (root) => { const next = removeRecent(get().recents, root); write(next); set({ recents: next }); },
  clear: () => { write([]); set({ recents: [] }); },
}));

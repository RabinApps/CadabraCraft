import { create } from "zustand";
import { readStored, writeStored } from "../lib/persisted";

const KEY = "cadabracraft.recents";
export const MAX_RECENTS = 8;

/** What the Home dashboard shows about a book without opening it. Refreshed while the book is open. */
export interface BookStats {
  author: string;
  chapters: number;
  words: number;
  /** 1-based position of the open chapter, 0 when the open page is front or back matter. */
  chapterNo: number;
  chapterTitle: string;
}

export interface Recent {
  root: string;
  title: string;
  openedAt: number;
  /** When the word count last changed; the dashboard falls back to `openedAt` until then. */
  editedAt?: number;
  stats?: BookStats;
}

/** Move (or add) a project to the front, replacing any entry for the same folder, and cap the list. Keeps what is known about it. */
export function addRecent(list: Recent[], entry: Recent, max = MAX_RECENTS): Recent[] {
  const prev = list.find((r) => r.root === entry.root);
  return [{ ...prev, ...entry }, ...list.filter((r) => r.root !== entry.root)].slice(0, max);
}

const sameStats = (a: BookStats, b: BookStats) =>
  a.author === b.author &&
  a.chapters === b.chapters &&
  a.words === b.words &&
  a.chapterNo === b.chapterNo &&
  a.chapterTitle === b.chapterTitle;

/** Record the latest stats of a listed book. Returns the same list when nothing changed. A changed word count marks the book as edited. */
export function updateStats(list: Recent[], root: string, stats: BookStats, now: number): Recent[] {
  const at = list.findIndex((r) => r.root === root);
  const prev = list[at];
  if (!prev || (prev.stats && sameStats(prev.stats, stats))) return list;
  const edited = prev.stats && prev.stats.words !== stats.words ? now : prev.editedAt;
  const next = { ...prev, stats, ...(edited === undefined ? {} : { editedAt: edited }) };
  return list.map((r, i) => (i === at ? next : r));
}

export function removeRecent(list: Recent[], root: string): Recent[] {
  return list.filter((r) => r.root !== root);
}

function parseStats(v: unknown): BookStats | undefined {
  const s = v as Partial<Record<keyof BookStats, unknown>> | null;
  if (
    s &&
    typeof s.author === "string" &&
    typeof s.chapterTitle === "string" &&
    Number.isFinite(s.chapters) &&
    Number.isFinite(s.words) &&
    Number.isFinite(s.chapterNo)
  )
    return s as BookStats;
  return undefined;
}

/** Tolerant parse of the stored value: drops malformed entries and duplicates, never throws. */
export function parseRecents(raw: string | null, max = MAX_RECENTS): Recent[] {
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(v)) return [];
    const out: Recent[] = [];
    for (const e of v) {
      if (
        e &&
        typeof e.root === "string" &&
        e.root !== "" &&
        typeof e.title === "string" &&
        Number.isFinite(e.openedAt) &&
        !out.some((r) => r.root === e.root)
      ) {
        const stats = parseStats(e.stats);
        out.push({
          root: e.root,
          title: e.title,
          openedAt: e.openedAt,
          ...(Number.isFinite(e.editedAt) ? { editedAt: e.editedAt } : {}),
          ...(stats ? { stats } : {}),
        });
      }
    }
    return out.slice(0, max);
  } catch {
    return [];
  }
}

const read = (): Recent[] => parseRecents(readStored(KEY));
const write = (list: Recent[]) => writeStored(KEY, JSON.stringify(list));

/** Recently opened projects. App preference only: absolute paths live here, never in project files. */
export const useRecents = create<{
  recents: Recent[];
  add: (root: string, title: string) => void;
  setStats: (root: string, stats: BookStats) => void;
  remove: (root: string) => void;
  clear: () => void;
}>((set, get) => ({
  recents: read(),
  add: (root, title) => {
    const next = addRecent(get().recents, { root, title, openedAt: Date.now() });
    write(next);
    set({ recents: next });
  },
  setStats: (root, stats) => {
    const next = updateStats(get().recents, root, stats, Date.now());
    if (next === get().recents) return;
    write(next);
    set({ recents: next });
  },
  remove: (root) => {
    const next = removeRecent(get().recents, root);
    write(next);
    set({ recents: next });
  },
  clear: () => {
    write([]);
    set({ recents: [] });
  },
}));

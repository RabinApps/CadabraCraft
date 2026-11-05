import { create } from "zustand";
import { readStored, writeStored } from "../lib/persisted";

const KEY = "cadabracraft.recents";
/** How many books Home shows as "recent". */
export const MAX_RECENTS = 8;
/** The Library's known-books list is not capped for an author, only against a runaway list filling localStorage. */
export const MAX_KNOWN = 2000;

/** What the Home dashboard shows about a book without opening it. Refreshed while the book is open. */
export interface BookStats {
  author: string;
  chapters: number;
  words: number;
  /** 1-based position of the open chapter, 0 when the open page is front or back matter. */
  chapterNo: number;
  chapterTitle: string;
  /** Cached for the Library, so it can show a cover and group a series without opening the book. */
  cover?: string;
  series?: string;
  seriesNumber?: string;
}

/** What a folder scan read from a manifest alone. Used until the book is opened and `stats` exist. */
export interface ScannedInfo {
  author: string;
  cover?: string;
  series?: string;
  seriesNumber?: string;
}

export interface Recent {
  root: string;
  title: string;
  openedAt: number;
  /** Set for a book found by scanning a folder and not opened yet. */
  scanned?: ScannedInfo;
  /** When the word count last changed; the dashboard falls back to `openedAt` until then. */
  editedAt?: number;
  stats?: BookStats;
}

/** The newest few books: what Home lists as recent. The list itself is kept newest first. */
export const newest = (list: readonly Recent[], n = MAX_RECENTS): Recent[] => list.slice(0, n);

/** Move (or add) a project to the front, replacing any entry for the same folder, and cap the list. Keeps what is known about it. */
export function addRecent(list: Recent[], entry: Recent, max = MAX_KNOWN): Recent[] {
  const prev = list.find((r) => r.root === entry.root);
  return [{ ...prev, ...entry }, ...list.filter((r) => r.root !== entry.root)].slice(0, max);
}

const sameStats = (a: BookStats, b: BookStats) =>
  a.author === b.author &&
  a.chapters === b.chapters &&
  a.words === b.words &&
  a.chapterNo === b.chapterNo &&
  a.chapterTitle === b.chapterTitle &&
  a.cover === b.cover &&
  a.series === b.series &&
  a.seriesNumber === b.seriesNumber;

/** Record the latest stats of a listed book. Returns the same list when nothing changed. A changed word count marks the book as edited. */
export function updateStats(list: Recent[], root: string, stats: BookStats, now: number): Recent[] {
  const at = list.findIndex((r) => r.root === root);
  const prev = list[at];
  if (!prev || (prev.stats && sameStats(prev.stats, stats))) return list;
  const edited = prev.stats && prev.stats.words !== stats.words ? now : prev.editedAt;
  const next = { ...prev, stats, ...(edited === undefined ? {} : { editedAt: edited }) };
  return list.map((r, i) => (i === at ? next : r));
}

/** A book read from a manifest by the folder scan. */
export interface ScannedBook extends ScannedInfo {
  root: string;
  title: string;
}

/**
 * Adds books found by a folder scan at the end of the list (they were never opened, so they are not "recent"). A book that is
 * already known is left alone: what was cached while it was open is newer than a manifest read. Returns the same list when
 * nothing is new.
 */
export function addScanned(
  list: Recent[],
  found: readonly ScannedBook[],
  max = MAX_KNOWN,
): Recent[] {
  const known = new Set(list.map((r) => r.root));
  const added: Recent[] = [];
  for (const { root, title, ...info } of found) {
    if (known.has(root)) continue;
    known.add(root);
    added.push({ root, title, openedAt: 0, scanned: info });
  }
  return added.length === 0 ? list : [...list, ...added].slice(0, max);
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
    return {
      author: s.author,
      chapters: s.chapters as number,
      words: s.words as number,
      chapterNo: s.chapterNo as number,
      chapterTitle: s.chapterTitle,
      ...(typeof s.cover === "string" && s.cover ? { cover: s.cover } : {}),
      ...(typeof s.series === "string" && s.series ? { series: s.series } : {}),
      ...(typeof s.seriesNumber === "string" && s.seriesNumber
        ? { seriesNumber: s.seriesNumber }
        : {}),
    };
  return undefined;
}

const optionalText = (v: unknown, key: string) => (typeof v === "string" && v ? { [key]: v } : {});

function parseScanned(v: unknown): ScannedInfo | undefined {
  const s = v as Partial<Record<keyof ScannedInfo, unknown>> | null;
  if (!s || typeof s.author !== "string") return undefined;
  return {
    author: s.author,
    ...optionalText(s.cover, "cover"),
    ...optionalText(s.series, "series"),
    ...optionalText(s.seriesNumber, "seriesNumber"),
  };
}

/** Tolerant parse of the stored value: drops malformed entries and duplicates, never throws. */
export function parseRecents(raw: string | null, max = MAX_KNOWN): Recent[] {
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
        const scanned = parseScanned(e.scanned);
        out.push({
          root: e.root,
          title: e.title,
          openedAt: e.openedAt,
          ...(scanned ? { scanned } : {}),
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
  /** Adds books a folder scan found; returns how many were new. */
  addScanned: (found: readonly ScannedBook[]) => number;
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
  addScanned: (found) => {
    const before = get().recents;
    const next = addScanned(before, found);
    if (next === before) return 0;
    write(next);
    set({ recents: next });
    return next.length - before.length;
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

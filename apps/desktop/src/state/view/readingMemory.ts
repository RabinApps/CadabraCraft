import { readStoredJson, writeStored } from "../../lib/persisted";
import { useProject } from "../project/index";

/**
 * Where each book was last read, kept across sessions in the app preferences (localStorage), never in the project files. The key is the
 * book's folder, as the recent books list has it (an absolute path is fine in an app preference); an entry is the chapter at the
 * reading line and how far down that chapter the line was (0 to 1, so it survives a change of zoom, width or font).
 */
const KEY = "cadabracraft.readingPositions";
/** Books remembered; the least recently read ones are forgotten. */
export const MAX_BOOKS = 50;

export interface SavedPosition {
  id: string;
  fraction: number;
  at: number;
}
type Saved = Record<string, SavedPosition>;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Tolerant parse of the stored value: drops malformed entries and keeps at most `MAX_BOOKS`, newest first. Never throws. */
export function parseSaved(v: unknown): Saved {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const entries: [string, SavedPosition][] = [];
  for (const [root, e] of Object.entries(v)) {
    const p = e as Partial<SavedPosition> | null;
    if (
      p &&
      typeof p.id === "string" &&
      p.id &&
      Number.isFinite(p.fraction) &&
      Number.isFinite(p.at)
    )
      entries.push([root, { id: p.id, fraction: clamp01(p.fraction!), at: p.at! }]);
  }
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_BOOKS));
}

/** `saved` with the position of `root` set, forgetting the oldest book beyond the cap. */
export function withPosition(saved: Saved, root: string, p: SavedPosition): Saved {
  return parseSaved({ ...saved, [root]: { ...p, fraction: clamp01(p.fraction) } });
}

let cache: Saved | null = null;
const all = (): Saved => (cache ??= parseSaved(readStoredJson(KEY)));

export const savedPosition = (root: string): SavedPosition | null => all()[root] ?? null;

let timer: ReturnType<typeof setTimeout> | undefined;
let waiting: { root: string; id: string; fraction: number } | null = null;

/** Writes the waiting position now. */
export function flushReadingPosition(): void {
  clearTimeout(timer);
  const w = waiting;
  waiting = null;
  if (!w) return;
  cache = withPosition(all(), w.root, { id: w.id, fraction: w.fraction, at: Date.now() });
  writeStored(KEY, JSON.stringify(cache));
}

/** Remembers where the reader is. Scrolling calls this constantly, so the write waits until it pauses. */
export function rememberReadingPosition(root: string, id: string, fraction: number): void {
  waiting = { root, id, fraction };
  clearTimeout(timer);
  timer = setTimeout(flushReadingPosition, 400);
}

// The chapter that was open when each book was opened in this session, and the books whose saved position was already used.
const openedWith = new Map<string, string>();
const used = new Set<string>();
useProject.subscribe((s) => {
  if (s.root && s.currentId && !openedWith.has(s.root)) openedWith.set(s.root, s.currentId);
});

/**
 * The position to resume at when Read mode opens, once per book per session: only while the open chapter is still the one the
 * book opened with (a reader who has moved to another chapter in Write mode expects Read to start there), and only if the
 * saved chapter still exists.
 */
export function takeSavedPosition(
  root: string | null,
  currentId: string | null,
  ids: readonly string[],
): SavedPosition | null {
  if (!root || used.has(root)) return null;
  used.add(root);
  if (openedWith.get(root) !== currentId) return null;
  const saved = savedPosition(root);
  return saved && ids.includes(saved.id) ? saved : null;
}

/** For tests: forget everything held in memory. */
export function resetReadingMemory(): void {
  cache = null;
  waiting = null;
  clearTimeout(timer);
  openedWith.clear();
  used.clear();
}

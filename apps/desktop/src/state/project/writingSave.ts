import { recordSave, type WritingFile } from "@cadabracraft/shared";
import { bridgeStatsIo } from "../../lib/writing/bridgeStats";
import { localDateKey, updateWritingStats } from "../../lib/writing/statsFile";

/** How a count changes the file: `total` is the book's words now, `day` today's local date key. */
type Change = (file: WritingFile, total: number, day: string) => WritingFile;

/** Runs `change` on the stats file with the book's words. Returns the copy's name for an unreadable file, or null. Never throws. */
async function noteWriting(
  root: string,
  bookWords: () => Promise<number>,
  now: Date,
  change: Change,
): Promise<string | null> {
  try {
    const total = await bookWords();
    const day = localDateKey(now);
    const { backup } = await updateWritingStats(
      bridgeStatsIo(root),
      (file) => change(file, total, day),
      now,
    );
    return backup;
  } catch {
    // The save itself must not fail: when the count or the write fails, today's figure is only short.
    return null;
  }
}

/**
 * Adds the book's words since the last save to today in `stats.json`. Called after every page save. Returns the name of the copy
 * kept of an unreadable stats file, or null.
 */
export const noteWritingSave = (root: string, bookWords: () => Promise<number>, now = new Date()) =>
  noteWriting(root, bookWords, now, recordSave);

/**
 * Sets the baseline when the book has none yet (called as the book opens), so the first save counts only the words typed after
 * it opened. A book that already has a baseline is left as it is.
 */
export const noteWritingBaseline = (
  root: string,
  bookWords: () => Promise<number>,
  now = new Date(),
) =>
  noteWriting(root, bookWords, now, (file, total, day) =>
    file.lastTotal === null ? recordSave(file, total, day) : file,
  );

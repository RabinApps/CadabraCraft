import { isDateKey } from "../dates";
import type { DayWords } from "./summary";

/** The `stats.json` file in the project folder: the net words of each day and the book's word total at the last save. */
export interface WritingFile {
  version: 1;
  /** Net words by day, keyed by `YYYY-MM-DD`. */
  days: Record<string, number>;
  /** The book's words at the last save (the baseline the next save's difference is taken from); null before the first save. */
  lastTotal: number | null;
}

export const WRITING_FILE_VERSION = 1;

export const emptyWritingFile = (): WritingFile => ({
  version: WRITING_FILE_VERSION,
  days: {},
  lastTotal: null,
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The file's text as a `WritingFile`, or null when it is not one: not JSON, another version, a key that is not a date, a count
 * that is not an integer, or a negative total. A missing `lastTotal` reads as null.
 */
export function parseWritingFile(text: string): WritingFile | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== WRITING_FILE_VERSION || !isRecord(value.days))
    return null;
  const days: Record<string, number> = {};
  for (const [date, words] of Object.entries(value.days)) {
    if (!isDateKey(date) || !Number.isInteger(words)) return null;
    days[date] = words as number;
  }
  const lastTotal = value.lastTotal ?? null;
  if (lastTotal !== null && !(Number.isInteger(lastTotal) && (lastTotal as number) >= 0))
    return null;
  return { version: WRITING_FILE_VERSION, days, lastTotal: lastTotal as number | null };
}

/** The file's text, with the days in date order so a change shows as one changed line. */
export function serializeWritingFile(file: WritingFile): string {
  const days: Record<string, number> = {};
  for (const date of Object.keys(file.days).sort()) days[date] = file.days[date]!;
  return `${JSON.stringify({ version: file.version, days, lastTotal: file.lastTotal }, null, 2)}\n`;
}

/** The day records the summary and the heatmap read. */
export const writingRecords = (file: WritingFile): DayWords[] =>
  Object.entries(file.days).map(([date, words]) => ({ date, words }));

/**
 * Adds the change since the last save to `today`. The first save only sets the baseline, so the words the book already had are
 * not counted as written today. Returns the same object when nothing changed, so the caller can skip the write.
 */
export function recordSave(file: WritingFile, total: number, today: string): WritingFile {
  if (file.lastTotal === total) return file;
  if (file.lastTotal === null) return { ...file, lastTotal: total };
  const delta = total - file.lastTotal;
  return {
    ...file,
    days: { ...file.days, [today]: (file.days[today] ?? 0) + delta },
    lastTotal: total,
  };
}

import {
  emptyWritingFile,
  parseWritingFile,
  serializeWritingFile,
  type WritingFile,
} from "@cadabracraft/shared";

/** The writing history in the project folder (not in the book's content, not in cadabra.json). See docs/file-format.md. */
export const STATS_FILE = "stats.json";

/** Where the file is read and written: the project's read and write commands, with the folder already chosen. */
export interface StatsIo {
  read: (path: string) => Promise<{ contents: string; hash: string } | null>;
  write: (path: string, contents: string, baseHash: string | null) => Promise<unknown>;
}

export interface StatsUpdate {
  file: WritingFile;
  /** The name of the copy kept of a file that could not be read, or null when the file was readable. */
  backup: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day of `now` as `YYYY-MM-DD`. */
export const localDateKey = (now: Date): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** `stats.json.corrupt-YYYYMMDD-HHMMSS` for the local time of `now`. */
const corruptBase = (now: Date): string =>
  `${STATS_FILE}.corrupt-${localDateKey(now).replaceAll("-", "")}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

/** The first name that is not taken yet: the base name, then `-2`, `-3`... so an existing copy is never overwritten. */
async function freeBackupName(io: StatsIo, now: Date): Promise<string> {
  const base = corruptBase(now);
  let name = base;
  for (let n = 2; (await io.read(name)) !== null; n++) name = `${base}-${n}`;
  return name;
}

/**
 * Reads `stats.json`, applies `update` and writes the result back when it changed. A missing file is an empty history. A file that
 * is not a valid history is first copied to `stats.json.corrupt-<time>` (never overwritten), then replaced by an empty history,
 * and the copy's name is returned. `update` returns its argument unchanged to read without writing.
 */
export async function updateWritingStats(
  io: StatsIo,
  update: (file: WritingFile) => WritingFile,
  now: Date,
): Promise<StatsUpdate> {
  const read = await io.read(STATS_FILE);
  const parsed = read ? parseWritingFile(read.contents) : null;
  const corrupt = read !== null && parsed === null;
  let backup: string | null = null;
  if (read && corrupt) {
    backup = await freeBackupName(io, now);
    await io.write(backup, read.contents, null);
  }
  const start = parsed ?? emptyWritingFile();
  const file = update(start);
  if (file !== start || corrupt) {
    await io.write(STATS_FILE, serializeWritingFile(file), read?.hash ?? null);
  }
  return { file, backup };
}

import { describe, expect, it } from "vitest";
import {
  emptyWritingFile,
  recordSave,
  serializeWritingFile,
  type WritingFile,
} from "@cadabracraft/shared";
import { localDateKey, STATS_FILE, updateWritingStats, type StatsIo } from "../statsFile";

/** An in-memory project folder: the files by name, and every write made. */
function fakeIo(initial: Record<string, string> = {}) {
  const files = new Map<string, { contents: string; hash: string }>();
  const writes: { path: string; base: string | null }[] = [];
  const hashOf = (s: string) => `h${s.length}:${s.slice(0, 12)}`;
  for (const [path, contents] of Object.entries(initial)) {
    files.set(path, { contents, hash: hashOf(contents) });
  }
  const io: StatsIo = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, contents, baseHash) => {
      writes.push({ path, base: baseHash });
      files.set(path, { contents, hash: hashOf(contents) });
      return {};
    },
  };
  return { io, files, writes };
}

const NOW = new Date(2026, 10, 9, 14, 5, 7); // local 2026-11-09 14:05:07
const TODAY = "2026-11-09";

describe("localDateKey", () => {
  it("is the local calendar day, padded", () => {
    expect(localDateKey(new Date(2026, 0, 3, 23, 59))).toBe("2026-01-03");
  });
});

describe("updateWritingStats", () => {
  it("reads a missing file as an empty history and writes nothing when nothing changed", async () => {
    const { io, writes } = fakeIo();
    const result = await updateWritingStats(io, (f) => f, NOW);
    expect(result).toEqual({ file: emptyWritingFile(), backup: null });
    expect(writes).toEqual([]);
  });

  it("creates the file on the first change, with no base hash", async () => {
    const { io, files, writes } = fakeIo();
    const result = await updateWritingStats(io, (f) => recordSave(f, 500, TODAY), NOW);
    expect(result.file).toEqual({ version: 1, days: {}, lastTotal: 500 });
    expect(writes).toEqual([{ path: STATS_FILE, base: null }]);
    expect(files.get(STATS_FILE)?.contents).toBe(serializeWritingFile(result.file));
  });

  it("round-trips: a second update reads what the first one wrote and adds to it", async () => {
    const { io, writes } = fakeIo();
    await updateWritingStats(io, (f) => recordSave(f, 500, TODAY), NOW);
    const second = await updateWritingStats(io, (f) => recordSave(f, 800, TODAY), NOW);
    expect(second.file).toEqual({ version: 1, days: { [TODAY]: 300 }, lastTotal: 800 });
    // The second write names the hash of the file it replaces, so a change made outside the app is seen as a conflict.
    expect(writes[1]?.base).toMatch(/^h/);
  });

  it("reads an existing valid file and writes nothing when the update changes nothing", async () => {
    const file: WritingFile = { version: 1, days: { [TODAY]: 9 }, lastTotal: 100 };
    const { io, writes } = fakeIo({ [STATS_FILE]: serializeWritingFile(file) });
    const result = await updateWritingStats(io, (f) => recordSave(f, 100, TODAY), NOW);
    expect(result).toEqual({ file, backup: null });
    expect(writes).toEqual([]);
  });

  it("keeps a corrupt file as a timestamped copy, then replaces it with an empty history", async () => {
    const broken = '{"version":1,"days":{"not a date":"x"}';
    const { io, files, writes } = fakeIo({ [STATS_FILE]: broken });
    const result = await updateWritingStats(io, (f) => f, NOW);
    expect(result).toEqual({
      file: emptyWritingFile(),
      backup: "stats.json.corrupt-20261109-140507",
    });
    expect(files.get("stats.json.corrupt-20261109-140507")?.contents).toBe(broken);
    expect(writes[0]).toEqual({ path: "stats.json.corrupt-20261109-140507", base: null });
    expect(writes[1]?.path).toBe(STATS_FILE);
    expect(JSON.parse(files.get(STATS_FILE)!.contents)).toEqual({
      version: 1,
      days: {},
      lastTotal: null,
    });
  });

  it("never overwrites an existing copy: a later one gets a numbered name", async () => {
    const { io, files } = fakeIo({
      [STATS_FILE]: "garbage",
      "stats.json.corrupt-20261109-140507": "older copy",
      "stats.json.corrupt-20261109-140507-2": "second copy",
    });
    const result = await updateWritingStats(io, (f) => f, NOW);
    expect(result.backup).toBe("stats.json.corrupt-20261109-140507-3");
    expect(files.get("stats.json.corrupt-20261109-140507")?.contents).toBe("older copy");
    expect(files.get("stats.json.corrupt-20261109-140507-3")?.contents).toBe("garbage");
  });

  it("does not replace the corrupt file when its copy cannot be written", async () => {
    const { io, files } = fakeIo({ [STATS_FILE]: "garbage" });
    io.write = async () => {
      throw new Error("No space left on device");
    };
    await expect(updateWritingStats(io, (f) => f, NOW)).rejects.toThrow("No space");
    expect(files.get(STATS_FILE)?.contents).toBe("garbage");
  });
});

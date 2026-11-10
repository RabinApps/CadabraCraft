import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeWritingFile, type WritingFile } from "@cadabracraft/shared";

// The stats file goes through the Tauri bridge; here it is an in-memory map.
const files = new Map<string, string>();
vi.mock("../../../lib/writing/bridgeStats", () => ({
  bridgeStatsIo: () => ({
    read: async (path: string) => {
      const contents = files.get(path);
      return contents === undefined ? null : { contents, hash: `h${contents.length}` };
    },
    write: async (path: string, contents: string) => {
      files.set(path, contents);
      return {};
    },
  }),
}));

const { noteWritingBaseline, noteWritingSave } = await import("../writingSave");
const NOW = new Date(2026, 10, 9, 10, 0, 0);
const readStats = (): WritingFile => JSON.parse(files.get("stats.json")!);

beforeEach(() => files.clear());

describe("noteWritingBaseline", () => {
  it("sets the baseline when the book has none, so the first save counts only what is typed after opening", async () => {
    await noteWritingBaseline("/book", async () => 800, NOW);
    expect(readStats()).toEqual({ version: 1, days: {}, lastTotal: 800 });
    await noteWritingSave("/book", async () => 830, NOW);
    expect(readStats()).toEqual({ version: 1, days: { "2026-11-09": 30 }, lastTotal: 830 });
  });

  it("leaves an existing baseline and its days alone when the book is opened again", async () => {
    files.set(
      "stats.json",
      serializeWritingFile({ version: 1, days: { "2026-11-08": 5 }, lastTotal: 40 }),
    );
    const before = files.get("stats.json");
    await noteWritingBaseline("/book", async () => 999, NOW);
    expect(files.get("stats.json")).toBe(before);
  });
});

describe("noteWritingSave", () => {
  it("sets the baseline on the first save and adds the change on the next", async () => {
    expect(await noteWritingSave("/book", async () => 1000, NOW)).toBeNull();
    expect(readStats()).toEqual({ version: 1, days: {}, lastTotal: 1000 });
    expect(await noteWritingSave("/book", async () => 1250, NOW)).toBeNull();
    expect(readStats()).toEqual({ version: 1, days: { "2026-11-09": 250 }, lastTotal: 1250 });
  });

  it("writes nothing when the book has the same words as at the last save", async () => {
    files.set("stats.json", serializeWritingFile({ version: 1, days: {}, lastTotal: 40 }));
    const before = files.get("stats.json");
    await noteWritingSave("/book", async () => 40, NOW);
    expect(files.get("stats.json")).toBe(before);
  });

  it("returns the name of the copy kept of an unreadable file", async () => {
    files.set("stats.json", "{ broken");
    const backup = await noteWritingSave("/book", async () => 10, NOW);
    expect(backup).toBe("stats.json.corrupt-20261109-100000");
  });

  it("never fails the save: a word count that throws leaves the file as it was", async () => {
    files.set("stats.json", serializeWritingFile({ version: 1, days: {}, lastTotal: 5 }));
    const before = files.get("stats.json");
    const backup = await noteWritingSave(
      "/book",
      async () => {
        throw new Error("Missing chapter file manuscript/001.json");
      },
      NOW,
    );
    expect(backup).toBeNull();
    expect(files.get("stats.json")).toBe(before);
  });
});

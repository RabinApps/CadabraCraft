import { sourceFile, sourceTitle } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods, writeFile } from "../../test/fakeBridge";

const sources = new Map<string, Uint8Array>();
const enc = (s: string) => new TextEncoder().encode(s);
/** Every write of the manifest and every trash or restore, in order, with the chapter count the manifest listed. */
const log: string[] = [];
let failTrash = false;
vi.mock("../../lib/bridge", async () =>
  (await import("../../test/fakeBridge")).fakeBridge({
    ...trashMethods,
    trashFile: async (r: string, p: string) => {
      if (failTrash) throw new Error("trash is locked");
      log.push(`trash ${p}`);
      return trashMethods.trashFile(r, p);
    },
    restoreTrash: async (r: string, p: string) => {
      log.push(`restore ${p.slice(29)}`);
      return trashMethods.restoreTrash(r, p);
    },
    readImportSource: async (p: string) => {
      const b = sources.get(p);
      if (!b) throw new Error(`cannot read ${p}`);
      return b;
    },
    importAssetBytes: async (_r: string, name: string) => `assets/${name}`,
    writeFile: async (r: string, p: string, c: string) => {
      if (p === "cadabra.json") log.push(`manifest ${JSON.parse(c).chapters.length}`);
      return writeFile(r, p, c);
    },
  }),
);

import { useProject } from "../project/index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const titles = () => s().manifest!.chapters.map((c) => sourceTitle(c, s().manifest!.editions));
const files = () => s().manifest!.chapters.map((c) => sourceFile(c, s().manifest!.editions));
const trashed = () => [...disk.keys()].filter((k) => k.startsWith(".cadabra/trash/"));
const SRC = "# One\n\na\n\n# Two\n\nb\n";

beforeEach(async () => {
  sources.clear();
  disk.clear();
  log.length = 0;
  failTrash = false;
  useProject.setState({
    activeLanguage: null,
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    importReport: null,
    trash: [],
  });
  await a().createProject("/book", "Mine", "Me");
  sources.set("/src/b.md", enc(SRC));
});

describe("undo and redo of an import into the open book", () => {
  it("records one step named after the file, and keeps earlier steps", async () => {
    await a().add("Two!");
    await a().importIntoBook("/src/b.md");
    expect(s().history.undo.map((e) => e.label)).toEqual(["Add Two!", "Import b.md"]);
    expect(s().history.undo[1]!.imported).toHaveLength(2);
  });

  it("undo removes all the new chapters at once, redo brings them back with their text", async () => {
    await a().importIntoBook("/src/b.md");
    const [f1, f2] = files().slice(1);
    expect(titles()).toEqual(["Chapter One", "One", "Two"]);
    const text = disk.get(f1!);
    await a().undo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(1);
    expect(disk.has(f1!) || disk.has(f2!)).toBe(false);
    expect(trashed()).toHaveLength(2); // moved, never deleted
    expect(s().currentId).toBe("ch-1"); // the open new chapter is gone: falls back
    expect(s().notice).toContain("Import b.md");
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "One", "Two"]);
    expect(disk.get(f1!)).toBe(text);
    expect(disk.has(f2!)).toBe(true);
    expect(trashed()).toEqual([]);
    expect(
      s()
        .history.undo.at(-1)!
        .imported!.every((i) => !i.trashPath),
    ).toBe(true);
  });

  it("saves the manifest before trashing on undo, and restores the files before saving on redo", async () => {
    await a().importIntoBook("/src/b.md");
    const [f1, f2] = files().slice(1);
    log.length = 0;
    await a().undo();
    expect(log).toEqual(["manifest 1", `trash ${f1}`, `trash ${f2}`]);
    log.length = 0;
    await a().redo();
    expect(log.map((l) => l.split(" ")[0])).toEqual(["restore", "restore", "manifest"]);
    expect(log.at(-1)).toBe("manifest 3");
  });

  it("walks through earlier edits too: edit, import, undo, undo, redo, redo", async () => {
    await a().add("Two!");
    await a().rename("ch-2", "Deux");
    await a().importIntoBook("/src/b.md");
    expect(titles()).toEqual(["Chapter One", "Deux", "One", "Two"]);
    await a().undo(); // the import
    await a().undo(); // the rename
    expect(titles()).toEqual(["Chapter One", "Two!"]);
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "Deux"]);
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "Deux", "One", "Two"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(4);
  });

  it("a new edit after an undo drops the redo step and its trashed files stay in the trash", async () => {
    await a().importIntoBook("/src/b.md");
    await a().undo();
    await a().add("Fresh");
    expect(s().history.redo).toEqual([]);
    expect(titles()).toEqual(["Chapter One", "Fresh"]);
    expect(trashed()).toHaveLength(2);
  });

  it("redo retargets a file whose name was taken while it was away", async () => {
    await a().importIntoBook("/src/b.md");
    const [f1] = files().slice(1);
    await a().undo();
    disk.set(f1!, "{}"); // something else took the name
    await a().redo();
    const back = files()[1]!;
    expect(back).not.toBe(f1);
    expect(back).toMatch(/-2\.json$/);
    expect(disk.get(back)).toContain("One");
    expect(disk.get(f1!)).toBe("{}");
    expect(s().history.undo.at(-1)!.imported![0]!.path).toBe(back);
    await a().undo(); // and it still undoes
    expect(titles()).toEqual(["Chapter One"]);
    expect(disk.has(back)).toBe(false);
  });

  it("inserts at a position and undoes from there", async () => {
    await a().add("Two!");
    await a().importIntoBook("/src/b.md", { insertAt: 1 });
    expect(titles()).toEqual(["Chapter One", "One", "Two", "Two!"]);
    await a().undo();
    expect(titles()).toEqual(["Chapter One", "Two!"]);
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "One", "Two", "Two!"]);
  });

  it("keeps the book as it was when the files cannot be trashed, and when they left the trash", async () => {
    await a().importIntoBook("/src/b.md");
    failTrash = true;
    expect(await a().undo()).toBe(false);
    expect(titles()).toEqual(["Chapter One", "One", "Two"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(3);
    expect(s().history.undo).toHaveLength(1);
    failTrash = false;
    await a().undo();
    for (const k of trashed()) disk.delete(k);
    expect(await a().redo()).toBe(false);
    expect(titles()).toEqual(["Chapter One"]);
    expect(s().history.redo).toHaveLength(1);
  });

  it("puts back the files already restored when a later one is missing from the trash", async () => {
    await a().importIntoBook("/src/b.md");
    await a().undo();
    const second = trashed()[1]!;
    const saved = disk.get(second);
    disk.delete(second);
    expect(await a().redo()).toBe(false);
    expect(titles()).toEqual(["Chapter One"]);
    expect(trashed()).toHaveLength(1); // the first file is back in the trash
    expect(s().history.redo).toHaveLength(1);
    disk.set(second, saved!); // the missing file shows up again: redo now works
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "One", "Two"]);
  });
});

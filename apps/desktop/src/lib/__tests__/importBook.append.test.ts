import { sourceTitle } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PNG_BYTES, TINY_MD } from "../../../e2e/fixtures";
import { disk, writeFile } from "../../test/fakeBridge";

const sources = new Map<string, Uint8Array>();
const images = new Map<string, Uint8Array>();
let failWrite: string | null = null;
const enc = (s: string) => new TextEncoder().encode(s);
vi.mock("../bridge", async () =>
  (await import("../../test/fakeBridge")).fakeBridge({
    readImportSource: async (p: string) => {
      const b = sources.get(p);
      if (!b) throw new Error(`cannot read ${p}`);
      return b;
    },
    readImportImage: async (src: string, ref: string) => {
      const b = images.get(`${src}|${ref}`);
      if (!b) throw new Error(`image not found: ${ref}`);
      return b;
    },
    importAssetBytes: async (_r: string, name: string) => `assets/${name}`,
    writeFile: async (r: string, p: string, c: string) => {
      if (failWrite && p.includes(failWrite)) throw new Error("disk full");
      return writeFile(r, p, c);
    },
  }),
);

import { useProject } from "../../state/project/index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const chapterTitles = () =>
  s().manifest!.chapters.map((c) => sourceTitle(c, s().manifest!.editions));

beforeEach(async () => {
  sources.clear();
  images.clear();
  disk.clear();
  failWrite = null;
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    importReport: null,
  });
  await a().createProject("/book", "Mine", "Me");
});

describe("import into the open book", () => {
  it("appends the chosen chapters after the existing ones and leaves them untouched", async () => {
    const before = disk.get("manuscript/001-chapter-one.json");
    sources.set("/src/My_Book.md", enc(TINY_MD));
    images.set("/src/My_Book.md|img/pixel.png", PNG_BYTES);
    await a().importIntoBook("/src/My_Book.md");
    expect(chapterTitles()).toEqual(["Chapter One", "Alpha", "Beta"]);
    expect(disk.get("manuscript/001-chapter-one.json")).toBe(before);
    expect(disk.get("manuscript/002-alpha.json")).toContain('"src": "assets/pixel.png"');
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(3);
    expect(s().root).toBe("/book");
    expect(s().currentId).toBe(s().manifest!.chapters[1]!.id);
    expect(s().importReport).toMatchObject({ chapterCount: 2, imageCount: 1, title: "Mine" });
    expect(s().history.undo).toEqual([]);
  });

  it("follows the plan: reordered, merged and renamed chapters", async () => {
    sources.set("/src/b.md", enc("# One\n\na\n\n# Two\n\nb\n\n# Three\n\nc\n"));
    await a().importIntoBook("/src/b.md", {
      splitHeadingLevel: 1,
      plan: [
        { sources: [2], title: "Three first", include: true },
        { sources: [0, 1], title: "One and two", include: true },
      ],
    });
    expect(chapterTitles()).toEqual(["Chapter One", "Three first", "One and two"]);
    const merged = disk.get("manuscript/003-one-and-two.json")!;
    expect(merged.indexOf('"a"')).toBeLessThan(merged.indexOf('"b"'));
    expect(merged).toContain("Two");
  });

  it("changes nothing when the file cannot be read or no chapter is kept", async () => {
    const before = new Map(disk);
    await expect(a().importIntoBook("/src/missing.md")).rejects.toThrow(/cannot read/);
    sources.set("/src/b.md", enc("# One\n\na\n"));
    await expect(
      a().importIntoBook("/src/b.md", { plan: [{ sources: [0], title: "One", include: false }] }),
    ).rejects.toThrow(/at least one chapter/);
    expect(disk).toEqual(before);
    expect(s().importReport).toBeNull();
  });

  it("says what was stored when a chapter write fails, and does not list it in the book", async () => {
    sources.set("/src/b.md", enc("# One\n\na\n\n# Two\n\nb\n"));
    failWrite = "003-two";
    await expect(a().importIntoBook("/src/b.md")).rejects.toThrow(
      /disk full.*1 new chapter files and 0 images/,
    );
    expect(chapterTitles()).toEqual(["Chapter One"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(1);
    expect(s().importReport).toBeNull();
    failWrite = null; // the lock was released: a second try works
    await a().importIntoBook("/src/b.md");
    expect(chapterTitles()).toEqual(["Chapter One", "One", "Two"]);
  });

  it("refuses a second import while one is running", async () => {
    sources.set("/src/b.md", enc("# One\n\na\n"));
    const first = a().importIntoBook("/src/b.md");
    await expect(a().importIntoBook("/src/b.md")).rejects.toThrow(/already running/);
    await first;
    expect(chapterTitles()).toEqual(["Chapter One", "One"]);
  });
});

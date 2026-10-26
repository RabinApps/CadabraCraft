import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Rust project layer, including its conflict-copy rule.
const disk = new Map<string, string>();
const h = (s: string) => `h:${s.length}:${s.slice(0, 40)}`;
vi.mock("../lib/bridge", () => ({
  bridge: {
    createProject: async (_r: string, m: string) => { disk.set("cadabra.json", m); },
    readFile: async (_r: string, p: string) => (disk.has(p) ? { contents: disk.get(p)!, hash: h(disk.get(p)!) } : null),
    writeFile: async (_r: string, p: string, c: string, base: string | null) => {
      let conflict_copy: string | null = null;
      if (base && disk.has(p) && h(disk.get(p)!) !== base) { conflict_copy = p.replace(".json", ".conflict-x.json"); disk.set(conflict_copy, disk.get(p)!); }
      disk.set(p, c);
      return { hash: h(c), conflict_copy };
    },
    writeBytes: async (_r: string, p: string, b: number[]) => { disk.set(p, `bytes:${b.length}`); },
    backupManifest: async () => "backup",
    watchProject: async () => {},
    trashFile: async (_r: string, p: string) => { const c = disk.get(p)!; disk.delete(p); disk.set(`.cadabra/trash/${p}`, c); return "trash"; },
  },
}));

import { useProject } from "./store";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }] });

beforeEach(async () => {
  disk.clear();
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0 });
  await a().createProject("/p", "Book", "Me");
});

describe("project store", () => {
  it("creates a project with a first chapter on disk", () => {
    expect(s().manifest!.chapters.map((c) => c.title)).toEqual(["Chapter One"]);
    expect(disk.has("manuscript/001-chapter-one.json")).toBe(true);
  });
  it("flushes unsaved edits when switching chapters", async () => {
    await a().add("Two");
    await a().selectChapter("ch-1");
    a().setDraft(text("typed but not saved"));
    await a().selectChapter("ch-2");
    expect(disk.get("manuscript/001-chapter-one.json")).toContain("typed but not saved");
  });
  it("reorders chapters in the manifest only", async () => {
    await a().add("Two");
    await a().move("ch-2", -1);
    expect(s().manifest!.chapters.map((c) => c.id)).toEqual(["ch-2", "ch-1"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters[0].id).toBe("ch-2");
  });
  it("delete moves the file to the trash instead of removing it", async () => {
    await a().add("Two");
    a().setDraft(text("precious"));
    await a().saveCurrent(s().draft!);
    await a().remove("ch-2");
    expect(s().manifest!.chapters.map((c) => c.id)).toEqual(["ch-1"]);
    expect([...disk.keys()].some((k) => k.startsWith(".cadabra/trash/") && disk.get(k)!.includes("precious"))).toBe(true);
  });
  it("keeps both versions when a chapter changed outside the app", async () => {
    disk.set("manuscript/001-chapter-one.json", "edited by sync");
    await a().saveCurrent(text("mine"));
    expect(s().notice).toMatch(/kept as/);
    expect([...disk.values()]).toContain("edited by sync");
    expect(disk.get("manuscript/001-chapter-one.json")).toContain("mine");
  });
  it("exports every chapter into exports/", async () => {
    await a().add("Two");
    await a().exportEpub();
    expect(disk.get("exports/book.epub")).toMatch(/^bytes:/);
  });
  it("reopens a project from disk", async () => {
    const json = disk.get("cadabra.json")!;
    useProject.setState({ manifest: null, currentId: null });
    await a().openProject("/p");
    expect(JSON.stringify(s().manifest, null, 2) + "\n").toBe(json);
    expect(s().currentId).toBe("ch-1");
  });
  it("refuses a folder without a manifest", async () => {
    disk.delete("cadabra.json");
    await expect(a().openProject("/p")).rejects.toThrow(/No cadabra.json/);
  });

  describe("external changes", () => {
    it("reloads the current chapter when there are no unsaved edits", async () => {
      disk.set("manuscript/001-chapter-one.json", JSON.stringify(text("from sync")));
      await a().externalChange("manuscript/001-chapter-one.json");
      expect(JSON.stringify(s().currentDoc)).toContain("from sync");
      expect(s().reloadCount).toBe(1);
    });
    it("does not clobber unsaved edits and warns instead", async () => {
      a().setDraft(text("mine"));
      disk.set("manuscript/001-chapter-one.json", JSON.stringify(text("from sync")));
      await a().externalChange("manuscript/001-chapter-one.json");
      expect(s().draft).toEqual(text("mine"));
      expect(s().reloadCount).toBe(0);
      expect(s().notice).toMatch(/keep both versions/);
    });
    it("ignores the echo of our own writes", async () => {
      await a().saveCurrent(text("ours"));
      await a().externalChange("manuscript/001-chapter-one.json");
      expect(s().reloadCount).toBe(0);
    });
    it("picks up a manifest changed outside, and survives a corrupt one", async () => {
      const m = JSON.parse(disk.get("cadabra.json")!);
      m.chapters[0].title = "Renamed elsewhere";
      disk.set("cadabra.json", JSON.stringify(m));
      await a().externalChange("cadabra.json");
      expect(s().manifest!.chapters[0]!.title).toBe("Renamed elsewhere");
      disk.set("cadabra.json", "{broken");
      await a().externalChange("cadabra.json");
      expect(s().manifest!.chapters[0]!.title).toBe("Renamed elsewhere");
      expect(s().notice).toMatch(/could not be read/);
    });
  });
});

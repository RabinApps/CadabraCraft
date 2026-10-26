import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the Rust project layer (same trash naming and -2 restore rule as the real commands).
const disk = new Map<string, string>();
const h = (s: string) => `h:${s.length}:${s.slice(0, 40)}`;
vi.mock("../lib/bridge", () => ({
  bridge: {
    createProject: async (_r: string, m: string) => { disk.set("cadabra.json", m); },
    readFile: async (_r: string, p: string) => (disk.has(p) ? { contents: disk.get(p)!, hash: h(disk.get(p)!) } : null),
    writeFile: async (_r: string, p: string, c: string) => { disk.set(p, c); return { hash: h(c), conflict_copy: null }; },
    backupManifest: async () => "backup",
    watchProject: async () => {},
    trashFile: async (_r: string, p: string) => {
      const c = disk.get(p);
      if (c === undefined) throw new Error(`${p} does not exist`);
      let to = `.cadabra/trash/20260101-1200-${p.replaceAll("/", "__")}`;
      for (let n = 2; disk.has(to); n++) to = `.cadabra/trash/20260101-1200-${p.replaceAll("/", "__")}`.replace(/\.json$/, `-${n}.json`);
      disk.delete(p); disk.set(to, c); return to;
    },
    listTrash: async () => [...disk.keys()].filter((k) => k.startsWith(".cadabra/trash/")).map((k) => ({ path: k, original: k.slice(29).replaceAll("__", "/"), trashed_at: "20260101-1200" })),
    restoreTrash: async (_r: string, p: string) => {
      if (!disk.has(p)) throw new Error(`${p} does not exist`);
      const orig = p.slice(29).replaceAll("__", "/");
      let to = orig;
      for (let n = 2; disk.has(to); n++) to = orig.replace(/\.json$/, `-${n}.json`);
      disk.set(to, disk.get(p)!); disk.delete(p); return to;
    },
  },
}));

import { useProject } from "./store";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }] });
const titles = () => s().manifest!.chapters.map((c) => c.title);
const trashed = () => [...disk.keys()].filter((k) => k.startsWith(".cadabra/trash/"));

beforeEach(async () => {
  disk.clear();
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0, trash: [] });
  await a().createProject("/p", "Book", "Me");
});

describe("book history (undo and redo of chapter-tree edits)", () => {
  it("starts empty, also right after creating a project", () => {
    expect(s().history).toEqual({ undo: [], redo: [] });
    expect(titles()).toEqual(["Chapter One"]);
  });
  it("undoes and redoes rename and move", async () => {
    await a().add("Two");
    await a().rename("ch-2", "Deux");
    await a().move("ch-2", -1);
    expect(titles()).toEqual(["Deux", "Chapter One"]);
    await a().undo();
    expect(titles()).toEqual(["Chapter One", "Deux"]);
    await a().undo();
    expect(titles()).toEqual(["Chapter One", "Two"]);
    await a().redo();
    await a().redo();
    expect(titles()).toEqual(["Deux", "Chapter One"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters[0].title).toBe("Deux");
  });
  it("does not record a move that changes nothing", async () => {
    await a().move("ch-1", -1);
    expect(s().history.undo).toEqual([]);
  });
  it("undoing an add moves the page to the trash; redo brings it back with its text", async () => {
    await a().add("Two");
    a().setDraft(text("keep me"));
    await a().flush();
    const file = s().manifest!.chapters[1]!.file;
    await a().undo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(disk.has(file)).toBe(false);
    expect(trashed().some((k) => disk.get(k)!.includes("keep me"))).toBe(true); // never hard-deleted
    expect(s().currentId).toBe("ch-1");
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "Two"]);
    expect(disk.get(file)).toContain("keep me");
    expect(trashed()).toEqual([]);
    expect(s().currentId).toBe("ch-2");
  });
  it("undoing a remove restores the file from the trash and opens it; redo trashes it again", async () => {
    await a().add("Two");
    a().setDraft(text("precious"));
    await a().flush();
    const ids = s().manifest!.chapters.map((c) => c.id);
    await a().remove("ch-2");
    expect(trashed()).toHaveLength(1);
    await a().undo();
    expect(s().manifest!.chapters.map((c) => c.id)).toEqual(ids);
    expect(disk.get(s().manifest!.chapters[1]!.file)).toContain("precious");
    expect(trashed()).toEqual([]);
    expect(s().currentId).toBe("ch-2");
    await a().redo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(trashed().some((k) => disk.get(k)!.includes("precious"))).toBe(true);
    expect(s().currentId).toBe("ch-1");
  });
  it("undoing the removal of a matter page puts it back in its own section with its kind", async () => {
    await a().addMatter("front", "dedication");
    await a().remove("fm-1");
    await a().undo();
    expect(s().manifest!.frontMatter).toMatchObject([{ id: "fm-1", kind: "dedication" }]);
    await a().undo(); // the add
    expect(s().manifest!.frontMatter).toEqual([]);
    expect(trashed()).toHaveLength(1);
  });
  it("undoes a restore from the trash by trashing the page again", async () => {
    await a().add("Two");
    await a().remove("ch-2");
    await a().refreshTrash();
    await a().restoreTrash(s().trash[0]!.path);
    expect(titles()).toEqual(["Chapter One", "Two"]);
    await a().undo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(trashed()).toHaveLength(1);
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "Two"]);
    expect(trashed()).toEqual([]);
  });
  it("a new edit drops the redo stack", async () => {
    await a().add("Two");
    await a().undo();
    expect(s().history.redo).toHaveLength(1);
    await a().rename("ch-1", "Uno");
    expect(s().history.redo).toEqual([]);
    expect(await a().redo()).toBe(false);
  });
  it("keeps other manifest fields and flushes unsaved typing when undoing", async () => {
    await a().add("Two");
    useProject.setState({ manifest: { ...s().manifest!, template: "modern" } });
    a().setDraft(text("typed on chapter two"));
    await a().undo();
    expect(s().manifest!.template).toBe("modern");
    expect([...disk.values()].some((v) => v.includes("typed on chapter two"))).toBe(true); // saved, then trashed with the page
  });
  it("a restored page that had to take another name stays consistent through redo and undo", async () => {
    await a().add("Two");
    const file = s().manifest!.chapters[1]!.file;
    await a().remove("ch-2");
    disk.set(file, "squatter"); // something outside the app took the name
    await a().undo();
    const back = s().manifest!.chapters[1]!.file;
    expect(back).not.toBe(file);
    expect(disk.get(file)).toBe("squatter");
    await a().redo();
    expect(titles()).toEqual(["Chapter One"]);
    await a().undo();
    expect(disk.has(s().manifest!.chapters[1]!.file)).toBe(true);
    expect(disk.get(file)).toBe("squatter");
  });
  it("reports the problem and keeps the history when the trashed file is gone", async () => {
    await a().add("Two");
    await a().remove("ch-2");
    for (const k of trashed()) disk.delete(k);
    expect(await a().undo()).toBe(false);
    expect(s().notice).toMatch(/Could not undo/);
    expect(titles()).toEqual(["Chapter One"]);
    expect(s().history.undo).toHaveLength(2);
  });
  it("clears on open and on an external change of the chapter list", async () => {
    await a().add("Two");
    await a().externalChange("cadabra.json"); // our own write: nothing to reload
    expect(s().history.undo).toHaveLength(1);
    disk.set("cadabra.json", disk.get("cadabra.json")!.replace("Two", "Zwei"));
    await a().externalChange("cadabra.json");
    expect(s().history).toEqual({ undo: [], redo: [] });
    await a().add("Three");
    await a().openProject("/p");
    expect(s().history).toEqual({ undo: [], redo: [] });
  });
  it("does nothing with an empty history", async () => {
    expect(await a().undo()).toBe(false);
    expect(await a().redo()).toBe(false);
  });
});

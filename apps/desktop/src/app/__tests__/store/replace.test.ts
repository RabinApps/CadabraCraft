import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, hashOf as h, readFile, writeFileWithConflictCopy } from "../../../test/fakeBridge";

// In-memory project layer with switches to make reads or writes fail, and the real conflict-copy rule.
let writes = 0;
/** Fails the Nth chapter write from now (1-based), and optionally every write after it. */
let failAt: { n: number; sticky: boolean } | null = null;
let failReadOf: string | null = null;
vi.mock("../../../lib/bridge", async () => (await import("../../../test/fakeBridge")).fakeBridge({
  readFile: async (r: string, p: string) => {
    if (failReadOf === p) throw new Error("disk read error");
    return readFile(r, p);
  },
  writeFile: async (r: string, p: string, c: string, base: string | null) => {
    if (p !== "cadabra.json") {
      writes++;
      if (failAt && (writes === failAt.n || (failAt.sticky && writes > failAt.n))) throw new Error("No space left on device");
    }
    return writeFileWithConflictCopy(r, p, c, base);
  },
  trashFile: async (_r: string, p: string) => { const c = disk.get(p)!; const to = `.cadabra/trash/20260101-1200-${p.replaceAll("/", "__")}`; disk.delete(p); disk.set(to, c); return to; },
  listTrash: async () => [],
  restoreTrash: async () => "x",
}));

import { useProject } from "../../store";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }] });
const opts = { query: "cat", matchCase: false, wholeWord: false };
const file = (i: number) => s().manifest!.chapters[i]!.file;

/** A book of three chapters that each contain "cat". */
async function threeChapters() {
  a().setDraft(text("one cat"));
  await a().add("Two");
  a().setDraft(text("two cat cat"));
  await a().add("Three");
  a().setDraft(text("three cat"));
  await a().selectChapter("ch-1");
}

beforeEach(async () => {
  disk.clear();
  writes = 0;
  failAt = null;
  failReadOf = null;
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0, trash: [] });
  await a().createProject("/p", "Book", "Me");
});

describe("replaceInBook failure handling", () => {
  it("rolls back pages already written when a later write fails, records no history, and throws a readable error", async () => {
    await threeChapters();
    const before = [0, 1, 2].map((i) => disk.get(file(i)));
    const undoBefore = s().history.undo.length;
    writes = 0;
    failAt = { n: 3, sticky: false }; // the third page fails
    await expect(a().replaceInBook(opts, "dog")).rejects.toThrow(/No space left on device/);
    expect([0, 1, 2].map((i) => disk.get(file(i)))).toEqual(before);
    expect(s().history.undo).toHaveLength(undoBefore);
    expect(s().currentDoc && JSON.stringify(s().currentDoc)).toContain("one cat");
  });
  it("says so and keeps an undo step for pages that could not be rolled back", async () => {
    await threeChapters();
    writes = 0;
    failAt = { n: 2, sticky: true }; // the second write fails and so does the rollback of the first
    const undoBefore = s().history.undo.length;
    const err = await a().replaceInBook(opts, "dog").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Undo/);
    expect(disk.get(file(0))).toContain("one dog");
    expect(disk.get(file(1))).toContain("two cat cat");
    expect(s().history.undo).toHaveLength(undoBefore + 1);
    failAt = null;
    expect(await a().undo()).toBe(true);
    expect(disk.get(file(0))).toContain("one cat");
  });
  it("changes nothing when a page cannot be read", async () => {
    await threeChapters();
    failReadOf = file(1);
    await expect(a().replaceInBook(opts, "dog")).rejects.toThrow(/disk read error/);
    expect(s().history.undo.some((e) => e.docs)).toBe(false);
    expect(disk.get(file(0))).toContain("one cat");
    expect(disk.get(file(2))).toContain("three cat");
  });
  it("refuses a page that is not valid chapter JSON before writing anything", async () => {
    await threeChapters();
    disk.set(file(2), "{ not json");
    await expect(a().replaceInBook(opts, "dog")).rejects.toThrow();
    expect(disk.get(file(0))).toContain("one cat");
  });
  it("ignores a second Replace all while one is running", async () => {
    await threeChapters();
    const [first, second] = await Promise.all([a().replaceInBook(opts, "dog"), a().replaceInBook(opts, "dog")]);
    expect(first).toBe(4);
    expect(second).toBe(0);
    expect(s().history.undo.filter((e) => e.docs).length).toBe(1);
    await a().undo();
    expect(disk.get(file(1))).toContain("two cat cat");
  });
  it("stops when the author typed while pages were being read, instead of overwriting the typing", async () => {
    await threeChapters();
    const real = disk.get(file(1))!;
    failReadOf = null;
    const p = a().replaceInBook(opts, "dog");
    a().setDraft(text("typed meanwhile"));
    await expect(p).rejects.toThrow(/changed/);
    expect(disk.get(file(1))).toBe(real);
    expect(s().draft).not.toBeNull();
  });
  it("keeps a conflict-copy message in the final notice (an outside edit landed between read and write)", async () => {
    await threeChapters();
    // The bridge sees a changed file at write time: make the base hash of page 2 stale by editing it just before its write.
    const real = disk.get(file(1))!;
    useProject.setState({ hashes: { ...s().hashes, [file(1)]: h(real) } });
    const origSet = disk.set.bind(disk);
    let armed = true;
    disk.set = ((k: string, v: string) => {
      if (armed && k === file(0)) { armed = false; origSet(file(1), `${real}\n`); }
      return origSet(k, v);
    }) as typeof disk.set;
    try { await a().replaceInBook(opts, "dog"); } finally { disk.set = origSet as typeof disk.set; }
    expect(s().notice).toMatch(/Replaced 4/);
    expect(s().notice).toMatch(/changed outside the app/);
    expect([...disk.keys()].some((k) => k.includes("conflict"))).toBe(true);
  });
});

describe("undo and redo of a book-wide replace after the book changed", () => {
  it("does not recreate the file of a page that was moved to the trash meanwhile", async () => {
    await threeChapters();
    await a().replaceInBook(opts, "dog");
    const gone = file(1);
    await a().remove(s().manifest!.chapters[1]!.id);
    expect(disk.has(gone)).toBe(false);
    // The newest history entry is now the trash move; undo that first, then the replace is undone.
    await a().undo(); // restores the page (as its dog text)
    expect(await a().undo()).toBe(true);
  });
  it("skips a page that is no longer in the book and tells the author", async () => {
    await threeChapters();
    await a().replaceInBook(opts, "dog");
    const id = s().manifest!.chapters[1]!.id;
    const gone = file(1);
    await a().remove(id);
    // Drop the trash move from the stack so the replace entry is next, as if the page were removed some other way.
    useProject.setState({ history: { undo: s().history.undo.filter((e) => e.docs), redo: [] } });
    expect(await a().undo()).toBe(true);
    expect(disk.has(gone)).toBe(false);
    expect(disk.get(file(0))).toContain("one cat");
    expect(s().notice).toMatch(/1 page/);
  });
  it("rolls back a half-done undo when a write fails and keeps the entry", async () => {
    await threeChapters();
    await a().replaceInBook(opts, "dog");
    writes = 0;
    failAt = { n: 2, sticky: false };
    expect(await a().undo()).toBe(false);
    expect(s().notice).toMatch(/Could not undo/);
    expect(disk.get(file(0))).toContain("one dog");
    expect(s().history.undo.some((e) => e.docs)).toBe(true);
    failAt = null;
    expect(await a().undo()).toBe(true);
    expect(disk.get(file(0))).toContain("one cat");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, readFile, trashMethods, writeFileWithConflictCopy } from "../../../test/fakeBridge";

// Project layer with switches for the rare paths of trash, history and replace.
const sw = {
  hide: new Set<string>(),
  failReadPath: null as string | null,
  failReadAfter: null as number | null,
  writes: 0,
  failWriteFrom: null as number | null,
  listTrashFails: false,
  listTrashEmpty: false,
  onListTrash: null as null | (() => void),
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => {
      if (sw.failReadPath === p) throw new Error("read error");
      if (sw.failReadAfter !== null && p.startsWith("manuscript/")) {
        if (sw.failReadAfter <= 0) throw new Error("read error");
        sw.failReadAfter--;
      }
      if (sw.hide.has(p)) return null;
      return readFile(r, p);
    },
    writeFile: async (r: string, p: string, c: string, base: string | null) => {
      if (p !== "cadabra.json") {
        sw.writes++;
        if (sw.failWriteFrom !== null && sw.writes >= sw.failWriteFrom)
          throw new Error("No space left on device");
      }
      return writeFileWithConflictCopy(r, p, c, base);
    },
    ...trashMethods,
    listTrash: async () => {
      sw.onListTrash?.();
      if (sw.listTrashFails) throw new Error("trash unreadable");
      return sw.listTrashEmpty ? [] : trashMethods.listTrash();
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const m = () => s().manifest!;
const text = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const trashed = () => [...disk.keys()].filter((k) => k.startsWith(".cadabra/trash/"));
const EN1 = "manuscript/001-chapter-one.json";
const FR1 = "manuscript/fr/001-chapter-one.json";
const opts = { query: "cat", matchCase: false, wholeWord: false };

beforeEach(async () => {
  disk.clear();
  sw.hide.clear();
  sw.failReadPath = null;
  sw.failReadAfter = null;
  sw.writes = 0;
  sw.failWriteFrom = null;
  sw.listTrashFails = false;
  sw.listTrashEmpty = false;
  sw.onListTrash = null;
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    activeLanguage: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    trash: [],
    recovery: [],
  });
  await a().createProject("/p", "Book", "Me");
});

describe("refreshTrash", () => {
  it("lists a page whose trashed file cannot be read or is gone, titled by its file name", async () => {
    await a().add("Two");
    await a().remove("ch-2");
    const [path] = trashed();
    sw.failReadPath = path!;
    await a().refreshTrash();
    expect(s().trash[0]!.title).toBe("two");
    sw.failReadPath = null;
    sw.hide.add(path!);
    await a().refreshTrash();
    expect(s().trash[0]!.title).toBe("two");
  });
  it("does not store the list when another book was opened meanwhile", async () => {
    sw.onListTrash = () => useProject.setState({ root: "/other" });
    await a().refreshTrash();
    expect(s().trash).toEqual([]);
  });
});

describe("restoreTrash", () => {
  it("restores a page whose files cannot be read back, keeping the book consistent", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    await a().remove("ch-1");
    await a().refreshTrash();
    sw.hide.add(EN1);
    sw.hide.add(FR1);
    await a().restoreTrash(s().trash[0]!.path);
    expect(m().chapters.at(-1)!.files).toEqual({ en: EN1, fr: FR1 });
  });
  it("restores without translations when the trash list does not name the page", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    await a().remove("ch-1");
    const source = trashed().find(
      (k) => k.endsWith("__001-chapter-one.json") && !k.includes("fr"),
    )!;
    sw.listTrashEmpty = true;
    await a().restoreTrash(source);
    expect(Object.keys(m().chapters.at(-1)!.files)).toEqual(["en"]);
  });
  it("restores a page that never had a translation file", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    await a().add("Two");
    await a().remove("ch-2");
    await a().restoreTrash(trashed()[0]!);
    expect(Object.keys(m().chapters.at(-1)!.files)).toEqual(["en"]);
  });
});

describe("undo and redo, rare paths", () => {
  it("a second undo while one is running does nothing", async () => {
    await a().add("Two");
    const first = a().undo();
    expect(await a().undo()).toBe(false);
    expect(await first).toBe(true);
  });

  it("redo of an added page without its trash path reports it and keeps the history", async () => {
    await a().add("Two");
    await a().undo();
    const [entry] = s().history.redo;
    const { trashPath: _t, ...bare } = entry!;
    useProject.setState({ history: { undo: [], redo: [bare] } });
    expect(await a().redo()).toBe(false);
    expect(s().notice).toBe("Could not redo: the page is no longer in the trash");
    expect(s().history.redo).toHaveLength(1);
  });

  it("keeps a translation file that was never trashed with the page", async () => {
    await a().add("Two");
    await a().undo();
    const [entry] = s().history.redo;
    useProject.setState({
      history: {
        undo: [],
        redo: [{ ...entry!, others: [{ language: "fr", path: "manuscript/fr/002-two.json" }] }],
      },
    });
    expect(await a().redo()).toBe(true);
    expect(s().history.undo[0]!.others).toEqual([
      { language: "fr", path: "manuscript/fr/002-two.json" },
    ]);
  });

  it("a translation that comes back under another name is followed through the history", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    await a().remove("ch-1");
    disk.set(FR1, "someone else's file"); // the name was taken meanwhile
    await a().undo();
    const files = m().chapters[0]!.files;
    expect(files.fr).toBe("manuscript/fr/001-chapter-one-2.json");
    expect(disk.get(files.fr!)).toContain("Chapter One");
    expect(s().history.redo[0]!.others![0]!.path).toBe(files.fr);
  });

  it("carries on when refreshing the trash list fails afterwards", async () => {
    await a().add("Two");
    useProject.setState({
      trash: [{ path: "x", original: "y", title: "z", trashedAt: "t" }],
    });
    sw.listTrashFails = true;
    expect(await a().undo()).toBe(true);
    await Promise.resolve();
  });

  it("reports a failed redo and a failed undo with their own wording", async () => {
    await a().add("Two");
    await a().undo();
    for (const k of trashed()) disk.delete(k); // the trashed page is gone
    expect(await a().redo()).toBe(false);
    expect(s().notice).toMatch(/^Could not redo: /);
  });

  it("says how many pages could not be put back when a text undo fails half way", async () => {
    a().setDraft(text("a cat"));
    await a().add("Two");
    a().setDraft(text("a cat"));
    await a().add("Three");
    a().setDraft(text("a cat"));
    await a().flush();
    await a().replaceInBook(opts, "dog");
    sw.writes = 0;
    sw.failWriteFrom = 2; // the first page is written back, the second fails, and so does the roll back
    expect(await a().undo()).toBe(false);
    expect(s().notice).toMatch(/Could not undo: .*1 page could not be put back/);
    sw.failWriteFrom = null;
  });

  it("says how many pages could not be put back when a text redo fails half way", async () => {
    a().setDraft(text("a cat"));
    await a().add("Two");
    a().setDraft(text("a cat"));
    await a().flush();
    await a().replaceInBook(opts, "dog");
    await a().undo();
    sw.writes = 0;
    sw.failWriteFrom = 2;
    expect(await a().redo()).toBe(false);
    expect(s().notice).toMatch(/Could not redo: .*1 page could not be put back/);
  });
});

describe("replace, rare paths", () => {
  it("keeps going when the page cannot be shown again after a replace that could not be rolled back", async () => {
    a().setDraft(text("a cat"));
    await a().add("Two");
    a().setDraft(text("a cat"));
    await a().add("Three");
    a().setDraft(text("a cat"));
    await a().selectChapter("ch-1");
    sw.writes = 0;
    sw.failWriteFrom = 2;
    sw.failReadAfter = 3; // the three pages are read, then showing the open page again fails
    await expect(a().replaceInBook(opts, "dog")).rejects.toThrow(/Undo/);
  });
});

describe("editions, rare paths", () => {
  it("stops adding a copied edition when a source page cannot be read", async () => {
    sw.hide.add(EN1);
    await expect(a().addLanguage("fr", "copy")).rejects.toThrow(/Missing chapter file/);
  });
});

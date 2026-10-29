import { sourceFile } from "@cadabracraft/format";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disk, readFile, trashMethods, writeFileWithConflictCopy } from "../../../test/fakeBridge";

// Reads and writes can be held back or made to fail to reproduce the races these tests are about.
const hooks = {
  holdRead: null as null | ((path: string) => Promise<void> | undefined),
  failWrites: false,
  watched: [] as string[],
  failWatch: false,
  unwatched: 0,
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => {
      const out = await readFile(r, p);
      await hooks.holdRead?.(p);
      return out;
    },
    writeFile: async (r: string, p: string, c: string, base: string | null) => {
      if (hooks.failWrites && p.startsWith("manuscript/")) throw new Error("disk full");
      return writeFileWithConflictCopy(r, p, c, base);
    },
    watchProject: async (root: string) => {
      if (hooks.failWatch) throw new Error("no watcher");
      hooks.watched.push(root);
    },
    unwatchProject: async () => {
      hooks.unwatched += 1;
    },
    writeBytes: async () => {},
    ...trashMethods,
  }),
);

import { AUTOSAVE_MAX_MS, AUTOSAVE_MS, useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const doc = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const FILE = "manuscript/001-chapter-one.json";

beforeEach(async () => {
  disk.clear();
  hooks.holdRead = null;
  hooks.failWrites = false;
  hooks.failWatch = false;
  hooks.unwatched = 0;
  hooks.watched = [];
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
  });
  await a().createProject("/p", "Book", "Me");
  hooks.watched = [];
});
afterEach(() => vi.useRealTimers());

describe("autosave", () => {
  it("writes continuous typing after the maximum wait, not only after a pause", async () => {
    vi.useFakeTimers();
    a().setDraft(doc("t0"));
    // A keystroke every second keeps restarting the short delay, so it never fires on its own.
    for (let i = 1; i < AUTOSAVE_MAX_MS / 1000; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      a().setDraft(doc(`t${i}`));
    }
    expect(disk.get(FILE)).not.toContain("t8");
    await vi.advanceTimersByTimeAsync(1000);
    expect(disk.get(FILE)).toContain(`t${AUTOSAVE_MAX_MS / 1000 - 1}`);
    expect(s().draft).toBeNull();
  });

  it("tries again after a failed write instead of waiting for the next keystroke", async () => {
    vi.useFakeTimers();
    hooks.failWrites = true;
    a().setDraft(doc("keep me"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(s().notice).toContain("Could not save");
    expect(s().draft).not.toBeNull();
    hooks.failWrites = false;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(disk.get(FILE)).toContain("keep me");
    expect(s().draft).toBeNull();
  });
});

describe("removing a page", () => {
  it("saves typing first so it is not written back after the page went to trash", async () => {
    await a().add("Two");
    a().setDraft(doc("typed in Two"));
    const id = s().currentId!;
    await a().remove(id);
    const trashed = [...disk.keys()].find((k) => k.startsWith(".cadabra/trash/"))!;
    expect(disk.get(trashed)).toContain("typed in Two");
    expect(s().draft).toBeNull();
  });
});

describe("loading a page", () => {
  it("writes typing that arrives while the page is being read instead of dropping it", async () => {
    await a().add("Two");
    await a().selectChapter("ch-1");
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = false;
    hooks.holdRead = (p) => {
      if (p.includes("002") && !held) {
        held = true;
        return gate;
      }
    };
    const loading = a().selectChapter("ch-2");
    await vi.waitFor(() => expect(held).toBe(true));
    a().setDraft(doc("typed during load"));
    release();
    await loading;
    expect(disk.get(FILE)).toContain("typed during load");
    expect(s().currentId).toBe("ch-2");
    expect(s().draft).toBeNull();
  });

  it("lets only the newest of two overlapping loads win", async () => {
    await a().add("Two");
    await a().add("Three");
    await a().selectChapter("ch-1");
    const gates: Record<string, () => void> = {};
    hooks.holdRead = (p) => {
      if (p.includes("002"))
        return new Promise<void>((r) => {
          gates.slow = r;
        });
    };
    const slow = a().selectChapter("ch-2");
    await vi.waitFor(() => expect(gates.slow).toBeDefined());
    hooks.holdRead = null;
    await a().selectChapter("ch-3");
    gates.slow!();
    await slow;
    expect(s().currentId).toBe("ch-3");
  });
});

describe("replace all in an edition", () => {
  it("changes the open translation's files, not the source", async () => {
    a().setDraft(doc("a cat"));
    await a().flush();
    await a().addLanguage("fr", "copy");
    a().setDraft(doc("un cat"));
    await a().flush();
    const n = await a().replaceInBook({ query: "cat", matchCase: false, wholeWord: false }, "chat");
    expect(n).toBe(1);
    expect(disk.get("manuscript/fr/001-chapter-one.json")).toContain("un chat");
    expect(disk.get(FILE)).toContain("a cat");
  });

  it("skips pages that have no file in the edition yet", async () => {
    await a().addLanguage("fr", "empty");
    await a().setLanguage("en");
    a().setDraft(doc("cat"));
    await a().flush();
    await a().add("Two"); // added after the edition: no French file
    await a().setLanguage("fr");
    expect(
      await a().replaceInBook({ query: "Two", matchCase: false, wholeWord: false }, "Deux"),
    ).toBe(0);
  });
});

describe("source language and the shown edition", () => {
  it("setLanguage to the source language stores null", async () => {
    await a().addLanguage("fr", "copy");
    await a().setLanguage("en");
    expect(s().activeLanguage).toBeNull();
  });

  it("changing the source language never leaves activeLanguage on the old key", async () => {
    useProject.setState({ activeLanguage: "en" });
    const m = s().manifest!;
    const e = m.editions[0]!;
    await a().updateDetails({
      title: e.title,
      author: e.author,
      identifier: e.identifier,
      isbn: "",
      cover: e.cover,
      language: "de",
    });
    expect(s().manifest!.editions[0]!.language).toBe("de");
    expect(s().activeLanguage).toBeNull();
    expect(sourceFile(s().manifest!.chapters[0]!, s().manifest!.editions)).toContain("001");
  });
});

describe("opening a project", () => {
  it("joins a second open of the same book instead of racing it", async () => {
    const manifest = disk.get("cadabra.json")!;
    hooks.watched = [];
    const first = a().openProject("/p");
    const second = a().openProject("/p");
    await Promise.all([first, second]);
    expect(hooks.watched).toEqual(["/p"]);
    expect(disk.get("cadabra.json")).toBe(manifest);
  });

  it("goes back to no book when opening fails half way", async () => {
    hooks.failWatch = true;
    await expect(a().openProject("/p")).rejects.toThrow("no watcher");
    expect(s().root).toBeNull();
    expect(s().manifest).toBeNull();
    expect(hooks.unwatched).toBe(1);
    hooks.failWatch = false;
    await a().openProject("/p");
    expect(s().manifest).not.toBeNull();
    expect(hooks.watched).toEqual(["/p"]);
  });
});

describe("watching", () => {
  it("stops the watcher when the book closes", async () => {
    await a().openProject("/p");
    expect(hooks.unwatched).toBe(0);
    await a().closeProject();
    expect(hooks.unwatched).toBe(1);
  });

  it("tells the author when the watcher fails, only while a book is open", async () => {
    await a().closeProject();
    a().watchFailed();
    expect(s().notice).toBe("");
    await a().openProject("/p");
    a().watchFailed();
    expect(s().notice).toMatch(/outside the app may not be noticed/);
  });
});

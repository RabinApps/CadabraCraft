import { sourceFile, type EditionEntry } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, hashOf as h } from "../../../test/fakeBridge";

// In-memory stand-in for the Rust snapshot commands: a page keeps its previous text as a snapshot when it is overwritten.
const snaps = new Map<string, { path: string; at: string }[]>();
const calls: string[] = [];
let stale: { path: string; snapshot: string }[] = [];
// What the book snapshot holds per page, and what restoring the whole book reports.
const bookPages = new Map<string, string>();
let restored = {
  safety: "",
  written: [] as string[],
  trashed: [] as string[],
  missing_assets: [] as string[],
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeFile: async (_r: string, p: string, c: string) => {
      const old = disk.get(p);
      if (old !== undefined && old !== c && p.startsWith("manuscript/")) {
        const list = snaps.get(p) ?? [];
        const path = `.cadabra/backups/${20261027}-${1000 + list.length}-${p.replaceAll("/", "__")}`;
        disk.set(path, old);
        snaps.set(p, [{ path, at: "20261027-1000" }, ...list]);
      }
      disk.set(p, c);
      return { hash: h(c), conflict_copy: null };
    },
    listSnapshots: async (_r: string, p: string) => snaps.get(p) ?? [],
    readSnapshot: async (_r: string, _p: string, s: string) => ({
      contents: disk.get(s)!,
      hash: h(disk.get(s)!),
    }),
    restoreSnapshot: async (_r: string, p: string, s: string) => {
      const text = disk.get(s)!;
      calls.push(`restore ${p} ${s}`);
      disk.set(p, text);
      return { hash: h(text), conflict_copy: null };
    },
    findStalePages: async () => stale,
    restorePageFromBookSnapshot: async (_r: string, _s: string, p: string) => {
      calls.push(`page-from-book ${p}`);
      disk.set(p, bookPages.get(p)!);
      return { hash: h(bookPages.get(p)!), conflict_copy: null };
    },
    restoreBookSnapshot: async (_r: string, s: string) => {
      calls.push(`restore-book ${s}`);
      return restored;
    },
    pruneSnapshots: async (_r: string, paths: string[], keep: number) => {
      calls.push(`prune ${paths.join(",")} ${keep}`);
      return 0;
    },
  }),
);

import { useProject } from "../index";
import { useSettings } from "../../editorPrefs";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});

beforeEach(async () => {
  disk.clear();
  snaps.clear();
  bookPages.clear();
  calls.length = 0;
  stale = [];
  useSettings.getState().set({ snapshotKeep: 50 });
  await a().closeProject();
  await a().createProject("/proj", "Book", "Me");
});

describe("opening a book", () => {
  it("prunes with the configured keep count over every page file", async () => {
    useSettings.getState().set({ snapshotKeep: 20 });
    await a().openProject("/proj");
    expect(calls).toContain("prune manuscript/001-chapter-one.json 20");
  });

  it("offers a page whose newest snapshot is newer than the saved page, by title", async () => {
    const file = sourceFile(s().manifest!.chapters[0]!, s().manifest!.editions);
    stale = [
      { path: file, snapshot: ".cadabra/backups/x" },
      { path: "manuscript/not-in-book.json", snapshot: ".cadabra/backups/y" },
    ];
    await a().openProject("/proj");
    expect(s().recovery).toEqual([
      {
        id: s().manifest!.chapters[0]!.id,
        title: "Chapter One",
        file,
        snapshot: ".cadabra/backups/x",
      },
    ]);
    a().dismissRecovery(s().recovery[0]!.id);
    expect(s().recovery).toEqual([]);
  });

  it("opens normally when the recovery check fails", async () => {
    const { bridge } = await import("../../../lib/bridge");
    const original = bridge.findStalePages;
    bridge.findStalePages = () => {
      throw new Error("boom");
    };
    await a().openProject("/proj");
    expect(s().manifest).not.toBeNull();
    expect(s().recovery).toEqual([]);
    bridge.findStalePages = original;
  });
});

describe("restoring a snapshot", () => {
  it("puts the old text back, reloads the open page and reports it", async () => {
    const entry = s().manifest!.chapters[0]!;
    await a().saveCurrent(text("old words"));
    await a().saveCurrent(text("new words"));
    const snapshot = snaps.get(sourceFile(entry, s().manifest!.editions))![0]!.path;
    const before = s().reloadCount;
    await a().restoreSnapshot(entry.id, snapshot);
    expect(calls).toContain(`restore ${sourceFile(entry, s().manifest!.editions)} ${snapshot}`);
    expect(JSON.stringify(s().currentDoc)).toContain("old words");
    expect(s().reloadCount).toBe(before + 1);
    expect(s().notice).toMatch(/Restored an earlier version of Chapter One/);
  });

  it("opens another page when that is the one restored, and clears its recovery offer", async () => {
    await a().add("Second");
    const second = s().manifest!.chapters[1]!;
    const first = s().manifest!.chapters[0]!;
    await a().selectChapter(first.id);
    await a().saveCurrent(text("v1"));
    await a().selectChapter(second.id);
    await a().saveCurrent(text("two v1"));
    await a().saveCurrent(text("two v2"));
    await a().selectChapter(first.id);
    useProject.setState({
      recovery: [
        {
          id: second.id,
          title: "Second",
          file: sourceFile(second, s().manifest!.editions),
          snapshot: snaps.get(sourceFile(second, s().manifest!.editions))![0]!.path,
        },
      ],
    });
    await a().restoreSnapshot(
      second.id,
      snaps.get(sourceFile(second, s().manifest!.editions))![0]!.path,
    );
    expect(s().currentId).toBe(second.id);
    expect(s().recovery).toEqual([]);
    expect(JSON.stringify(s().currentDoc)).toContain("two v1");
  });

  it("does nothing for a page that is not in the book", async () => {
    await a().restoreSnapshot("missing", ".cadabra/backups/x");
    expect(calls.filter((c) => c.startsWith("restore"))).toEqual([]);
  });
});

describe("restoring from a whole-book snapshot", () => {
  const SNAP = ".cadabra/snapshots/20261028-1000.json";

  it("puts one page back from the snapshot, reloads it and reports it", async () => {
    const entry = s().manifest!.chapters[0]!;
    const file = sourceFile(entry, s().manifest!.editions);
    await a().saveCurrent(text("current words"));
    bookPages.set(file, JSON.stringify(text("snapshot words")));
    await a().restorePageFromBook(entry.id, SNAP);
    expect(calls).toContain(`page-from-book ${file}`);
    expect(JSON.stringify(s().currentDoc)).toContain("snapshot words");
    expect(s().notice).toMatch(/Restored Chapter One from a book snapshot/);
  });

  it("opens another page that is restored, and ignores a page that is not in the book", async () => {
    await a().add("Second");
    const [first, second] = s().manifest!.chapters as [EditionEntry, EditionEntry];
    await a().selectChapter(first.id);
    bookPages.set(sourceFile(second, s().manifest!.editions), JSON.stringify(text("two")));
    const offer = (id: string) => ({ id, title: id, file: `${id}.json`, snapshot: SNAP });
    useProject.setState({ recovery: [offer(second.id), offer(first.id)] });
    await a().restorePageFromBook(second.id, SNAP);
    expect(s().currentId).toBe(second.id);
    expect(s().recovery.map((r) => r.id)).toEqual([first.id]);
    calls.length = 0;
    await a().restorePageFromBook("missing", SNAP);
    expect(calls).toEqual([]);
  });

  it("restores the whole book, reopens it on the same page and says what moved", async () => {
    const first = s().manifest!.chapters[0]!;
    restored = { safety: "x", written: [], trashed: ["a", "b"], missing_assets: ["assets/p.png"] };
    await a().restoreBook(SNAP);
    expect(calls).toContain(`restore-book ${SNAP}`);
    expect(s().currentId).toBe(first.id);
    expect(s().notice).toBe(
      "Restored the whole book. It is kept as an automatic snapshot as it was before. 2 pages that were not in the snapshot are in the trash. 1 image it used is no longer in the book folder.",
    );
  });

  it("says only that the book was restored when nothing moved, and shows the first page when the open one is gone", async () => {
    restored = { safety: "x", written: [], trashed: [], missing_assets: [] };
    await a().restoreBook(SNAP);
    expect(s().notice).toBe(
      "Restored the whole book. It is kept as an automatic snapshot as it was before.",
    );
    // The restored manifest no longer has the open chapter.
    await a().add("Second");
    const second = s().manifest!.chapters[1]!;
    await a().selectChapter(second.id);
    const manifest = JSON.parse(disk.get("cadabra.json")!) as { chapters: { id: string }[] };
    manifest.chapters = manifest.chapters.filter((c) => c.id !== second.id);
    disk.set("cadabra.json", JSON.stringify(manifest));
    await a().restoreBook(SNAP);
    expect(s().currentId).toBe(s().manifest!.chapters[0]!.id);
  });
});

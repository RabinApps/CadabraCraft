import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, hashOf as h } from "../../../test/fakeBridge";

// In-memory stand-in for the Rust snapshot commands: a page keeps its previous text as a snapshot when it is overwritten.
const snaps = new Map<string, { path: string; at: string }[]>();
const calls: string[] = [];
let stale: { path: string; snapshot: string }[] = [];
vi.mock("../../../lib/bridge", async () => (await import("../../../test/fakeBridge")).fakeBridge({
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
  readSnapshot: async (_r: string, _p: string, s: string) => ({ contents: disk.get(s)!, hash: h(disk.get(s)!) }),
  restoreSnapshot: async (_r: string, p: string, s: string) => {
    const text = disk.get(s)!;
    calls.push(`restore ${p} ${s}`);
    disk.set(p, text);
    return { hash: h(text), conflict_copy: null };
  },
  findStalePages: async () => stale,
  pruneSnapshots: async (_r: string, paths: string[], keep: number) => { calls.push(`prune ${paths.join(",")} ${keep}`); return 0; },
}));

import { useProject } from "../../store";
import { useSettings } from "../../editorPrefs";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }] });

beforeEach(async () => {
  disk.clear();
  snaps.clear();
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
    const file = s().manifest!.chapters[0]!.file;
    stale = [{ path: file, snapshot: ".cadabra/backups/x" }, { path: "manuscript/not-in-book.json", snapshot: ".cadabra/backups/y" }];
    await a().openProject("/proj");
    expect(s().recovery).toEqual([{ id: s().manifest!.chapters[0]!.id, title: "Chapter One", file, snapshot: ".cadabra/backups/x" }]);
    a().dismissRecovery(s().recovery[0]!.id);
    expect(s().recovery).toEqual([]);
  });

  it("opens normally when the recovery check fails", async () => {
    const { bridge } = await import("../../../lib/bridge");
    const original = bridge.findStalePages;
    bridge.findStalePages = () => { throw new Error("boom"); };
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
    const snapshot = snaps.get(entry.file)![0]!.path;
    const before = s().reloadCount;
    await a().restoreSnapshot(entry.id, snapshot);
    expect(calls).toContain(`restore ${entry.file} ${snapshot}`);
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
    useProject.setState({ recovery: [{ id: second.id, title: "Second", file: second.file, snapshot: snaps.get(second.file)![0]!.path }] });
    await a().restoreSnapshot(second.id, snaps.get(second.file)![0]!.path);
    expect(s().currentId).toBe(second.id);
    expect(s().recovery).toEqual([]);
    expect(JSON.stringify(s().currentDoc)).toContain("two v1");
  });

  it("does nothing for a page that is not in the book", async () => {
    await a().restoreSnapshot("missing", ".cadabra/backups/x");
    expect(calls.filter((c) => c.startsWith("restore"))).toEqual([]);
  });
});

import { sourceFile } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, readFile, writeFileWithConflictCopy } from "../../../test/fakeBridge";

/** Fails the Nth chapter write from now (1-based), and optionally every write after it. */
let writes = 0;
let failAt: { n: number; sticky: boolean } | null = null;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => readFile(r, p),
    writeFile: async (r: string, p: string, c: string, base: string | null) => {
      if (p !== "cadabra.json") {
        writes++;
        if (failAt && (writes === failAt.n || (failAt.sticky && writes > failAt.n)))
          throw new Error("No space left on device");
      }
      return writeFileWithConflictCopy(r, p, c, base);
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const scene = (id: string, text: string, attrs: Record<string, unknown> = {}) => ({
  type: "scene",
  attrs: { id, title: id.toUpperCase(), ...attrs },
  content: [para(text)],
});
const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const file = (i: number) => sourceFile(s().manifest!.chapters[i]!, s().manifest!.editions);
const read = (i: number) =>
  JSON.parse(disk.get(file(i))!) as {
    content: { type: string; attrs?: Record<string, unknown> }[];
  };
const ids = (i: number) =>
  read(i).content.flatMap((b) => (b.type === "scene" ? [String(b.attrs!.id)] : []));

/** Two chapters: One holds scenes a, b and c; Two holds d. The first chapter is open. */
async function twoChapters() {
  await a().add("Two");
  disk.set(
    file(0),
    JSON.stringify({
      type: "doc",
      content: [
        heading("One"),
        scene("a", "alpha one"),
        scene("b", "bravo two"),
        scene("c", "charlie"),
      ],
    }),
  );
  disk.set(
    file(1),
    JSON.stringify({ type: "doc", content: [heading("Two"), scene("d", "delta")] }),
  );
  await a().selectChapter("ch-1");
}

beforeEach(async () => {
  disk.clear();
  writes = 0;
  failAt = null;
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    trash: [],
    history: { undo: [], redo: [] },
  });
  await a().createProject("/p", "Book", "Me");
});

describe("patchSceneIn", () => {
  it("changes a scene of a chapter that is not open, and records one undo step", async () => {
    await twoChapters();
    await a().selectChapter("ch-1");
    const ok = await a().patchSceneIn("ch-2", "d", { synopsis: "Delta arrives.", pov: "Dee" });
    expect(ok).toBe(true);
    expect(read(1).content[1]!.attrs).toMatchObject({
      id: "d",
      synopsis: "Delta arrives.",
      pov: "Dee",
    });
    expect(s().history.undo.at(-1)!.docs).toHaveLength(1);
    expect(await a().undo()).toBe(true);
    expect(read(1).content[1]!.attrs).not.toHaveProperty("synopsis");
    expect(await a().redo()).toBe(true);
    expect(read(1).content[1]!.attrs).toMatchObject({ synopsis: "Delta arrives." });
  });

  it("saves typing in the open chapter first and shows the change there", async () => {
    await twoChapters();
    a().setDraft({
      type: "doc",
      content: [
        heading("One"),
        scene("a", "typed"),
        scene("b", "bravo two"),
        scene("c", "charlie"),
      ],
    } as never);
    await a().patchSceneIn("ch-1", "b", { status: "draft" });
    const saved = read(0);
    expect(JSON.stringify(saved)).toContain("typed");
    expect(saved.content[2]!.attrs).toMatchObject({ id: "b", status: "draft" });
    expect(JSON.stringify(s().currentDoc)).toContain('"status":"draft"');
    expect(s().draft).toBeNull();
  });

  it("returns false for a chapter or scene that is not there, and writes nothing", async () => {
    await twoChapters();
    writes = 0;
    expect(await a().patchSceneIn("ch-9", "d", { title: "x" })).toBe(false);
    expect(await a().patchSceneIn("ch-2", "zz", { title: "x" })).toBe(false);
    expect(writes).toBe(0);
  });

  it("changes nothing and says so when the write fails", async () => {
    await twoChapters();
    const before = disk.get(file(1));
    writes = 0;
    failAt = { n: 1, sticky: false };
    await expect(a().patchSceneIn("ch-2", "d", { title: "x" })).rejects.toThrow(
      /Nothing was changed/,
    );
    expect(disk.get(file(1))).toBe(before);
    expect(s().history.undo.some((e) => e.docs)).toBe(false);
  });

  it("runs the next edit even when the one before it failed", async () => {
    await twoChapters();
    writes = 0;
    failAt = { n: 1, sticky: false };
    const first = a().patchSceneIn("ch-2", "d", { title: "x" });
    const second = a().patchSceneIn("ch-2", "d", { synopsis: "kept" });
    await expect(first).rejects.toThrow(/Nothing was changed/);
    await expect(second).resolves.toBe(true);
    expect(read(1).content[1]!.attrs).toMatchObject({ synopsis: "kept" });
  });
});

describe("moveScene", () => {
  it("reorders inside a chapter", async () => {
    await twoChapters();
    expect(await a().moveScene("a", "ch-1", 2)).toBe(true);
    expect(ids(0)).toEqual(["b", "c", "a"]);
    expect(await a().moveScene("a", "ch-1", 2)).toBe(false); // already there
    expect(await a().undo()).toBe(true);
    expect(ids(0)).toEqual(["a", "b", "c"]);
  });

  it("moves across chapters, destination first, as one undo step, losing nothing", async () => {
    await twoChapters();
    const order: string[] = [];
    writes = 0;
    expect(await a().moveScene("b", "ch-2", 0)).toBe(true);
    expect(ids(0)).toEqual(["a", "c"]);
    expect(ids(1)).toEqual(["b", "d"]);
    expect(JSON.stringify(read(1))).toContain("bravo two");
    expect(s().history.undo.filter((e) => e.docs)).toHaveLength(1);
    expect(
      s()
        .history.undo.at(-1)!
        .docs!.map((d) => d.file),
    ).toEqual([file(1), file(0)]);
    order.push(...ids(0), ...ids(1));
    expect(await a().undo()).toBe(true);
    expect(ids(0)).toEqual(["a", "b", "c"]);
    expect(ids(1)).toEqual(["d"]);
    expect(await a().redo()).toBe(true);
    expect(ids(1)).toEqual(["b", "d"]);
    expect(order).toEqual(["a", "c", "b", "d"]);
  });

  it("refreshes the open chapter's editor content", async () => {
    await twoChapters();
    await a().moveScene("a", "ch-2", 1);
    expect(JSON.stringify(s().currentDoc)).not.toContain("alpha one");
  });

  it("rolls the destination back when the source write fails, so the scene stays in one place", async () => {
    await twoChapters();
    const before = [disk.get(file(0)), disk.get(file(1))];
    writes = 0;
    failAt = { n: 2, sticky: false };
    await expect(a().moveScene("a", "ch-2", 0)).rejects.toThrow(/Nothing was changed/);
    expect([disk.get(file(0)), disk.get(file(1))]).toEqual(before);
  });

  it("keeps the scene in both chapters when the rollback fails too, and Undo finishes the job", async () => {
    await twoChapters();
    writes = 0;
    failAt = { n: 2, sticky: true };
    await expect(a().moveScene("a", "ch-2", 0)).rejects.toThrow(/two chapters/);
    expect(ids(0)).toContain("a");
    expect(ids(1)).toContain("a");
    failAt = null;
    expect(await a().undo()).toBe(true);
    expect(ids(1)).toEqual(["d"]);
  });

  it("refuses to drop a scene into a chapter that already holds that id", async () => {
    await twoChapters();
    disk.set(
      file(1),
      JSON.stringify({
        type: "doc",
        content: [heading("Two"), scene("a", "copy"), scene("d", "delta")],
      }),
    );
    await expect(a().moveScene("a", "ch-2", 0)).rejects.toThrow(/same id/);
    expect(ids(0)).toEqual(["a", "b", "c"]);
  });

  it("returns false when the scene or the target chapter is not there", async () => {
    await twoChapters();
    expect(await a().moveScene("zz", "ch-2", 0)).toBe(false);
    expect(await a().moveScene("a", "ch-9", 0)).toBe(false);
  });

  it("runs two drops one after the other", async () => {
    await twoChapters();
    const [x, y] = await Promise.all([
      a().moveScene("a", "ch-2", 0),
      a().moveScene("b", "ch-2", 0),
    ]);
    expect([x, y]).toEqual([true, true]);
    expect(ids(0)).toEqual(["c"]);
    expect(ids(1).sort()).toEqual(["a", "b", "d"]);
  });
});

describe("wrapUnsortedIn", () => {
  it("wraps loose text into a scene, and does nothing when there is none", async () => {
    await twoChapters();
    disk.set(
      file(1),
      JSON.stringify({
        type: "doc",
        content: [heading("Two"), para("loose words"), scene("d", "delta")],
      }),
    );
    const made = await a().wrapUnsortedIn("ch-2");
    expect(made).toHaveLength(1);
    expect(ids(1)).toEqual([made[0], "d"]);
    expect(await a().wrapUnsortedIn("ch-2")).toEqual([]);
    expect(await a().wrapUnsortedIn("ch-9")).toEqual([]);
    expect(await a().undo()).toBe(true);
    expect(ids(1)).toEqual(["d"]);
  });
});

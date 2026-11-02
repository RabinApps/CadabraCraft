import { tocSettingsOf } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods } from "../../../test/fakeBridge";

let failWrite = false;
let unreadable = new Set<string>();
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    ...trashMethods,
    writeFile: async (_r: string, path: string, contents: string) => {
      if (failWrite && path === "cadabra.json") throw new Error("disk full");
      disk.set(path, contents);
      return { hash: `h${contents.length}:${contents.slice(-20)}`, conflict_copy: null };
    },
    readFile: async (_r: string, path: string) => {
      if (unreadable.has(path)) return { contents: "{ not json", hash: "bad" };
      const contents = disk.get(path);
      return contents === undefined ? null : { contents, hash: `h${contents.length}` };
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const onDisk = () => JSON.parse(disk.get("cadabra.json")!);
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const toc = () => tocSettingsOf(s().manifest!.frontMatter.find((e) => e.kind === "contents")!);
const contentsId = () => s().manifest!.frontMatter.find((e) => e.kind === "contents")!.id;

beforeEach(async () => {
  disk.clear();
  failWrite = false;
  unreadable = new Set();
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
    trash: [],
  });
  await a().createProject("/p", "Book", "Me");
  await a().add("Two");
  await a().addMatter("front", "contents");
});

describe("contents page actions", () => {
  it("sets depth and page numbers and saves them on the contents page", async () => {
    await a().setTocDepth(contentsId(), 2);
    await a().setTocPageNumbers(contentsId(), false);
    expect(toc()).toMatchObject({ depth: 2, pageNumbers: false });
    expect(onDisk().frontMatter[0].toc).toMatchObject({ depth: 2, pageNumbers: false });
    expect(s().notice).toBe("");
  });

  it("renames in the shown language, hides, shows, and clears a rename with an empty text", async () => {
    const id = contentsId();
    await a().renameTocItem(id, "ch-1", " First ");
    expect(toc().titles).toEqual({ "ch-1": { en: "First" } });
    await a().hideTocItem(id, "ch-2");
    expect(toc().hidden).toEqual(["ch-2"]);
    await a().showTocItem(id, "ch-2");
    expect(toc().hidden).toEqual([]);
    await a().renameTocItem(id, "ch-1", "");
    expect(toc().titles).toEqual({});
  });

  it("renames in the open edition", async () => {
    await a().addLanguage("fr", "copy");
    await a().renameTocItem(contentsId(), "ch-1", "Premier");
    expect(toc().titles).toEqual({ "ch-1": { fr: "Premier" } });
  });

  it("moves an item, stores the whole order and does nothing when it would not move", async () => {
    const id = contentsId();
    const items = [{ key: "ch-1" }, { key: "ch-2" }] as never;
    await a().moveTocItem(id, items, "ch-2", 0);
    expect(toc().order).toEqual(["ch-2", "ch-1"]);
    const undo = s().history.undo.length;
    await a().moveTocItem(id, items, "ch-1", 0);
    expect(s().history.undo.length).toBe(undo); // no change, no history entry
    expect(s().notice).toBe("");
  });

  it("adds a custom entry and returns its key, then removes it", async () => {
    const id = contentsId();
    const key = await a().addTocCustom(id, { title: "Afterword", after: "ch-2", target: "ch-2" });
    expect(key).toBe("custom:c-1");
    expect(toc().custom).toEqual([
      { id: "c-1", titles: { en: "Afterword" }, after: "ch-2", target: "ch-2" },
    ]);
    await a().removeTocOverride(id, key!);
    expect(toc().custom).toEqual([]);
  });

  it("clears the overrides of one item and resets everything but depth and numbers", async () => {
    const id = contentsId();
    await a().setTocDepth(id, 1);
    await a().renameTocItem(id, "ch-1", "First");
    await a().hideTocItem(id, "ch-1");
    await a().removeTocOverride(id, "ch-1");
    expect(toc()).toMatchObject({ hidden: [], titles: {} });
    await a().hideTocItem(id, "ch-2");
    await a().addTocCustom(id, { title: "X", after: "ch-1" });
    await a().resetToc(id);
    expect(toc()).toEqual({ depth: 1, pageNumbers: true, hidden: [], titles: {}, custom: [] });
  });

  it("says so and keeps the list when the save fails or the change is refused", async () => {
    const id = contentsId();
    failWrite = true;
    await a().hideTocItem(id, "ch-1");
    expect(s().notice).toMatch(/Could not change the contents page: .*disk full/);
    expect(toc().hidden).toEqual([]);
    expect(s().history.undo.at(-1)!.label).toBe("Add Contents");
    failWrite = false;
    useProject.setState({ notice: "" });
    expect(await a().addTocCustom(id, { title: "   ", after: "ch-1" })).toBeNull();
    expect(s().notice).toMatch(/needs a title/);
    useProject.setState({ notice: "" });
    await a().setTocDepth("ch-1", 1); // not a contents page
    expect(s().notice).toMatch(/no contents page/);
  });

  it("undoes and redoes every kind of change", async () => {
    const id = contentsId();
    await a().setTocDepth(id, 3);
    await a().hideTocItem(id, "ch-1");
    expect(
      s()
        .history.undo.map((h) => h.label)
        .slice(-2),
    ).toEqual(["Change contents depth", "Hide contents entry"]);
    await a().undo();
    expect(toc().hidden).toEqual([]);
    expect(toc().depth).toBe(3);
    await a().undo();
    expect(toc().depth).toBe(0);
    await a().redo();
    await a().redo();
    expect(toc()).toMatchObject({ depth: 3, hidden: ["ch-1"] });
    expect(onDisk().frontMatter[0].toc.hidden).toEqual(["ch-1"]);
  });
});

describe("tocOutlines", () => {
  it("reads the headings of every listed page in the shown language", async () => {
    const file = s().manifest!.chapters[0]!.files.en!;
    disk.set(file, JSON.stringify({ type: "doc", content: [heading(1, "A"), heading(2, "B")] }));
    const outlines = await a().tocOutlines();
    expect(outlines["ch-1"]).toEqual([
      { index: 0, level: 1, text: "A" },
      { index: 1, level: 2, text: "B" },
    ]);
    expect(outlines["ch-2"]).toBeDefined();
    expect(outlines[contentsId()]).toBeUndefined(); // the contents page lists nothing of itself
  });

  it("skips a page with no file in the language and a page that cannot be read", async () => {
    await a().addLanguage("fr", "empty");
    const fr = s().manifest!.chapters[0]!.files.fr!;
    disk.delete(fr);
    expect((await a().tocOutlines())["ch-1"]).toBeUndefined();
    await a().setLanguage("en");
    unreadable.add(s().manifest!.chapters[1]!.files.en!);
    const outlines = await a().tocOutlines();
    expect(outlines["ch-2"]).toBeUndefined();
    expect(outlines["ch-1"]).toBeDefined();
  });

  it("lists no headings for a page that has no file in the language yet", async () => {
    const m = s().manifest!;
    useProject.setState({
      manifest: { ...m, chapters: m.chapters.map((c, i) => (i === 1 ? { ...c, files: {} } : c)) },
    });
    const outlines = await a().tocOutlines();
    expect(outlines["ch-2"]).toBeUndefined();
    expect(outlines["ch-1"]).toBeDefined();
  });

  it("leaves out the kinds the list does not show", async () => {
    await a().addMatter("front", "dedication");
    const dedication = s().manifest!.frontMatter.find((e) => e.kind === "dedication")!;
    expect((await a().tocOutlines())[dedication.id]).toBeUndefined();
  });
});

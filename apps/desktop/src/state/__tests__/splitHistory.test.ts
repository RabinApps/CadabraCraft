import { sourceFile, sourceTitle } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods, writeFile } from "../../test/fakeBridge";

let failFile: string | null = null;
let failTrash = false;
/** Every write of a file the split touches and every trash, in order. */
const log: string[] = [];
vi.mock("../../lib/bridge", async () =>
  (await import("../../test/fakeBridge")).fakeBridge({
    ...trashMethods,
    trashFile: async (r: string, p: string) => {
      if (failTrash) throw new Error("trash is locked");
      log.push(`trash ${p}`);
      return trashMethods.trashFile(r, p);
    },
    writeFile: async (r: string, p: string, c: string) => {
      if (p === failFile) throw new Error("disk full");
      log.push(`write ${p}`);
      return writeFile(r, p, c);
    },
  }),
);

import { useProject } from "../project/index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const titles = () => s().manifest!.chapters.map((c) => sourceTitle(c, s().manifest!.editions));
const files = () => s().manifest!.chapters.map((c) => sourceFile(c, s().manifest!.editions));
const p = (text: string, marks?: unknown[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});
const h = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const note = {
  type: "paragraph",
  content: [
    { type: "text", text: "Fact" },
    { type: "footnote", content: [{ type: "text", text: "A footnote." }] },
  ],
};
const doc = {
  type: "doc",
  content: [
    h(1, "Chapter One"),
    p("Intro."),
    h(2, "Second half"),
    p("Anchored", [{ type: "comment", attrs: { id: "t-2" } }]),
    note,
    { type: "image", attrs: { src: "assets/pic.png", alt: "Pic", title: null } },
  ],
};
const thread = (id: string) => ({
  id,
  author: "Me",
  body: `about ${id}`,
  created: "2026-01-01T00:00:00.000Z",
  resolved: false,
  replies: [],
});
const FILE = "manuscript/001-chapter-one.json";
const text = (v: unknown) => JSON.stringify(v, null, 2);
const read = (path: string) => JSON.parse(disk.get(path)!);
const trashed = () => [...disk.keys()].filter((k) => k.startsWith(".cadabra/trash/"));

beforeEach(async () => {
  disk.clear();
  log.length = 0;
  failFile = null;
  failTrash = false;
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
  await a().createProject("/book", "Mine", "Me");
  log.length = 0;
  disk.set(FILE, text(doc));
  disk.set(
    "comments/ch-1.json",
    `${JSON.stringify({ threads: [thread("t-1"), thread("t-2")] }, null, 2)}\n`,
  );
});

describe("splitting a chapter at a heading", () => {
  it("adds the rest as a new chapter right after it, in one undo step, and opens it", async () => {
    await a().add("Last");
    const id = await a().splitChapter("ch-1", 2, "");
    expect(titles()).toEqual(["Chapter One", "Second half", "Last"]);
    expect(s().currentId).toBe(id);
    expect(s().history.undo.map((e) => e.label)).toEqual(["Add Last", "Split Chapter One"]);
    const [first, second] = files();
    expect(first).toBe(FILE);
    expect(read(first!).content.map((n: { type: string }) => n.type)).toEqual([
      "heading",
      "paragraph",
    ]);
    const tail = read(second!);
    expect(tail.content[0]).toEqual(h(2, "Second half"));
    expect(JSON.stringify(tail)).toContain("A footnote.");
    expect(JSON.stringify(tail)).toContain("assets/pic.png");
    expect(s().notice).toContain("Second half");
  });

  it("uses the title the author typed, and moves the comments with their text", async () => {
    await a().splitChapter("ch-1", 2, "  Part two ");
    expect(titles()[1]).toBe("Part two");
    const newId = s().manifest!.chapters[1]!.id;
    expect(read(`comments/${newId}.json`).threads.map((x: { id: string }) => x.id)).toEqual([
      "t-2",
    ]);
    expect(read("comments/ch-1.json").threads.map((x: { id: string }) => x.id)).toEqual(["t-1"]);
  });

  it("writes the new files and the list before it shortens the chapter", async () => {
    await a().splitChapter("ch-1", 2, "");
    const order = log.filter((l) => l.startsWith("write"));
    const at = (needle: string) => order.findIndex((l) => l.includes(needle));
    expect(at("002-second-half")).toBeLessThan(at("cadabra.json"));
    expect(at("cadabra.json")).toBeLessThan(at(FILE));
  });

  it("undo puts the chapter back together, redo cuts it again, with the same text", async () => {
    const before = disk.get(FILE)!;
    const comments = disk.get("comments/ch-1.json")!;
    await a().splitChapter("ch-1", 2, "");
    const cutHead = disk.get(FILE)!;
    const cutTail = disk.get(files()[1]!)!;
    await a().undo();
    expect(titles()).toEqual(["Chapter One"]);
    expect(disk.get(FILE)).toBe(before);
    expect(disk.get("comments/ch-1.json")).toBe(comments);
    expect(trashed()).toHaveLength(1); // the new chapter's file: moved, never deleted
    expect(s().notice).toContain("Split Chapter One");
    expect(s().currentId).toBe("ch-1");
    await a().redo();
    expect(titles()).toEqual(["Chapter One", "Second half"]);
    expect(disk.get(FILE)).toBe(cutHead);
    expect(disk.get(files()[1]!)).toBe(cutTail);
    expect(trashed()).toEqual([]);
    expect(read("comments/ch-1.json").threads).toHaveLength(1);
  });

  it("reloads the open chapter on undo, so the editor shows the whole text again", async () => {
    await a().selectChapter("ch-1");
    await a().splitChapter("ch-1", 2, "");
    await a().selectChapter("ch-1");
    const count = s().reloadCount;
    await a().undo();
    expect(s().reloadCount).toBeGreaterThan(count);
    expect(s().currentDoc!.content).toHaveLength(6);
  });

  it("refuses a page that is not a chapter and a place that is not a heading", async () => {
    await expect(a().splitChapter("ch-1", 1, "")).rejects.toThrow(/not a heading/);
    await expect(a().splitChapter("ch-1", 0, "")).rejects.toThrow(/not a heading/);
    await expect(a().splitChapter("ch-9", 2, "")).rejects.toThrow(/Only a chapter/);
    await a().startPart("ch-1", "Part");
    await expect(a().splitChapter("pt-1", 2, "")).rejects.toThrow(/Only a chapter/);
    expect(s().history.undo.map((e) => e.label)).toEqual(["Add Part"]);
    expect(disk.get(FILE)).toBe(text(doc));
  });

  it("refuses when the book has a translation edition, and changes nothing", async () => {
    const m = s().manifest!;
    useProject.setState({
      manifest: {
        ...m,
        editions: [...m.editions, { ...m.editions[0]!, language: "fr" }],
      },
    });
    await expect(a().splitChapter("ch-1", 2, "")).rejects.toThrow(/translations/);
    expect(log.filter((l) => l.startsWith("write"))).toEqual([]);
  });

  it("changes nothing when a write fails: the book is as before, the text whole", async () => {
    failFile = FILE; // the last step fails
    await expect(a().splitChapter("ch-1", 2, "")).rejects.toThrow(
      /Nothing in the book was changed/,
    );
    failFile = null;
    expect(titles()).toEqual(["Chapter One"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(1);
    expect(disk.get(FILE)).toBe(text(doc));
    expect(s().history.undo).toEqual([]);
    expect(trashed()).toHaveLength(1); // the half-written new chapter went to the trash
  });

  it("keeps the text when undo cannot trash the new chapter: the split stays, nothing is lost", async () => {
    await a().splitChapter("ch-1", 2, "");
    const cutHead = disk.get(FILE)!;
    failTrash = true;
    expect(await a().undo()).toBe(false);
    failTrash = false;
    expect(titles()).toEqual(["Chapter One", "Second half"]);
    expect(disk.get(FILE)).toBe(cutHead);
    expect(s().history.undo).toHaveLength(1);
    expect(await a().undo()).toBe(true); // a retry works
    expect(titles()).toEqual(["Chapter One"]);
  });

  it("a new edit after an undo drops the redo step", async () => {
    await a().splitChapter("ch-1", 2, "");
    await a().undo();
    await a().add("Fresh");
    expect(s().history.redo).toEqual([]);
    expect(titles()).toEqual(["Chapter One", "Fresh"]);
  });
});

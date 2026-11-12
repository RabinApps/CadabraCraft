import { sourceFile } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, trashMethods } from "../../../test/fakeBridge";

const failing = vi.hoisted(() => ({ path: "" }));
vi.mock("../../../lib/bridge", async () => {
  const fake = (await import("../../../test/fakeBridge")).fakeBridge({
    writeFile: async (root: string, path: string, contents: string, hash: string | null) => {
      if (path === failing.path) throw new Error("disk full");
      return (await import("../../../test/fakeBridge")).writeFileWithConflictCopy(
        root,
        path,
        contents,
        hash,
      );
    },
    ...trashMethods,
  });
  return fake;
});

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const m = () => s().manifest!;
const p = (t: string, marks?: unknown) => ({
  type: "paragraph",
  content: [{ type: "text", text: t, ...(marks ? { marks } : {}) }],
});
const heading = (t: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text: t }],
});
const thread = (id: string) => ({
  id,
  author: "Me",
  body: "note",
  created: "2026-01-01T00:00:00.000Z",
  resolved: false,
  replies: [],
});
const comment = (id: string) => [{ type: "comment", attrs: { id } }];
const chapterFile = () => sourceFile(m().chapters[0]!, m().editions);
const chapterId = () => m().chapters[0]!.id;
const seed = (...blocks: unknown[]) =>
  disk.set(chapterFile(), JSON.stringify({ type: "doc", content: blocks }));

beforeEach(async () => {
  disk.clear();
  failing.path = "";
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
});

describe("splitChapter", () => {
  it("moves the text after the heading and the comments anchored there to a new chapter", async () => {
    seed(p("First", comment("keep")), heading("Second"), p("Tail", comment("go")));
    const file = chapterFile();
    const id = chapterId();
    disk.set(`comments/${id}.json`, JSON.stringify({ threads: [thread("keep"), thread("go")] }));
    await a().splitChapter(id, 1, " ");
    expect(m().chapters.map((e) => e.titles.en)).toEqual(["Chapter One", "Second"]);
    const created = m().chapters[1]!;
    expect(disk.get(file)).not.toContain("Tail");
    expect(disk.get(sourceFile(created, m().editions))).toContain("Tail");
    expect(disk.get(`comments/${created.id}.json`)).toContain('"go"');
    expect(disk.get(`comments/${id}.json`)).not.toContain('"go"');
    expect(disk.get(`comments/${id}.json`)).toContain('"keep"');
  });

  it("splits a chapter whose tail carries no comments, under the title it is given", async () => {
    seed(p("First"), heading("Second"), p("Tail"));
    await a().splitChapter(chapterId(), 1, "Named");
    expect(m().chapters[1]!.titles.en).toBe("Named");
  });

  it("splits when the tail's comments are anchored but the chapter has no comments file", async () => {
    seed(p("First"), heading("Second"), p("Tail", comment("go")));
    await a().splitChapter(chapterId(), 1, "");
    expect(m().chapters).toHaveLength(2);
  });

  it("splits when none of the comments are anchored in the tail", async () => {
    seed(p("First", comment("keep")), heading("Second"), p("Tail", comment("go")));
    const id = chapterId();
    disk.set(`comments/${id}.json`, JSON.stringify({ threads: [thread("keep")] }));
    await a().splitChapter(id, 1, "");
    expect(disk.get(`comments/${id}.json`)).toContain('"keep"');
    expect(disk.has(`comments/${m().chapters[1]!.id}.json`)).toBe(false);
  });

  it("refuses a place that is not a heading, a missing file, a part and a book with translations", async () => {
    seed(p("First"), heading("Second"), p("Tail"));
    await expect(a().splitChapter(chapterId(), 0, "")).rejects.toThrow(/not a heading/);
    await expect(a().splitChapter("nope", 1, "")).rejects.toThrow(/Only a chapter/);
    await a().addPart("Part I");
    const part = m().chapters.find((e) => e.kind === "part")!;
    await expect(a().splitChapter(part.id, 1, "")).rejects.toThrow(/Only a chapter/);
    disk.delete(chapterFile());
    await expect(a().splitChapter(chapterId(), 1, "")).rejects.toThrow(/file is missing/);
    seed(p("First"), heading("Second"), p("Tail"));
    await a().addLanguage("fr", "copy");
    await expect(a().splitChapter(chapterId(), 1, "")).rejects.toThrow(/translations/);
  });

  it("refuses when the comments cannot be read, changing nothing", async () => {
    seed(p("First"), heading("Second"), p("Tail", comment("go")));
    const id = chapterId();
    const before = disk.get(chapterFile());
    disk.set(`comments/${id}.json`, "{not json");
    await expect(a().splitChapter(id, 1, "")).rejects.toThrow(/not valid JSON/);
    disk.set(`comments/${id}.json`, JSON.stringify({ nope: 1 }));
    await expect(a().splitChapter(id, 1, "")).rejects.toThrow(/could not be read/);
    expect(disk.get(chapterFile())).toBe(before);
    expect(m().chapters).toHaveLength(1);
  });

  it("puts everything back when a write fails part-way", async () => {
    seed(p("First", comment("keep")), heading("Second"), p("Tail", comment("go")));
    const id = chapterId();
    const file = chapterFile();
    const before = disk.get(file);
    const commentsText = JSON.stringify({ threads: [thread("keep"), thread("go")] });
    disk.set(`comments/${id}.json`, commentsText);
    failing.path = file;
    await expect(a().splitChapter(id, 1, "")).rejects.toThrow(/not split/);
    expect(m().chapters).toHaveLength(1);
    expect(disk.get(`comments/${id}.json`)).toBe(commentsText);
    failing.path = "";
    expect(disk.get(file)).toBe(before);
  });
});

describe("parts", () => {
  it("adds a part, starts one before a chapter, and moves and removes it", async () => {
    await a().add("Two");
    await a().addPart("Part I");
    expect(m().chapters.map((e) => e.kind ?? "chapter")).toContain("part");
    const first = m().chapters[0]!.id;
    await a().startPart(first, "Part Zero");
    const parts = () => m().chapters.filter((e) => e.kind === "part");
    expect(parts()).toHaveLength(2);
    const id = parts()[1]!.id;
    const at = () => m().chapters.findIndex((e) => e.id === id);
    const before = at();
    await a().movePart(id, -1);
    expect(at()).toBeLessThan(before);
    const moved = at();
    await a().movePart(id, -1);
    await a().movePart(id, -1);
    expect(at()).toBeLessThanOrEqual(moved);
    await a().move(id, 1);
    expect(at()).toBeGreaterThanOrEqual(0);
    await a().move(id, -50);
  });

  it("leaves the book alone when a part cannot move, and removes a part with its divider", async () => {
    await a().addPart("Part I");
    const id = m().chapters.find((e) => e.kind === "part")!.id;
    const before = m();
    await a().move(id, -99);
    await a().movePart(id, -99);
    expect(m()).toEqual(before);
    await a().remove(id);
    expect(m().chapters.some((e) => e.kind === "part")).toBe(false);
  });

  it("adds a part and a page when no page is open", async () => {
    useProject.setState({ currentId: null });
    await a().addPart("Part I");
    useProject.setState({ currentId: null });
    await a().addMatter("back", "acknowledgments");
    expect(m().chapters.some((e) => e.kind === "part")).toBe(true);
    expect(m().backMatter.map((e) => e.kind)).toContain("acknowledgments");
  });

  it("ignores a snapshot of a page that is not in the book", async () => {
    await a().restoreSnapshot("nope", "snap");
    await a().restorePageFromBook("nope", "snap");
    expect(s().notice).toBe("");
  });
});

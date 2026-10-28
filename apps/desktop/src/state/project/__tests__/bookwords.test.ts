import { beforeEach, describe, expect, it, vi } from "vitest";
import { countWords } from "@cadabracraft/shared";
import { bigBook } from "../../../test/bigBook";
import { disk, readFile } from "../../../test/fakeBridge";

// In-memory project layer that counts reads, so the tests can prove which pages the word count touches.
const reads: string[] = [];
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => {
      reads.push(p);
      return readFile(r, p);
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const chapterReads = () => reads.filter((p) => p.startsWith("manuscript/"));
const para = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});
const BOOK = bigBook(100_000, 40, 5);
const BOOK_WORDS = BOOK.reduce((n, d) => n + countWords(d), 0);

/** Opens a 40-chapter, ~100k-word book whose first chapter is open. */
async function openBigBook() {
  disk.clear();
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
  });
  await a().createProject("/p", "Big", "Me");
  for (let i = 1; i < 40; i++) await a().add(`Chapter ${i + 1}`);
  s().manifest!.chapters.forEach((c, i) => disk.set(c.file, JSON.stringify(BOOK[i], null, 2)));
  await a().openProject("/p");
  await a().selectChapter(s().manifest!.chapters[0]!.id);
  reads.length = 0;
}

beforeEach(openBigBook);

describe("bookWords is incremental", () => {
  it("first count reads each chapter other than the open one once, and matches the real total", async () => {
    expect(await a().bookWords()).toBe(BOOK_WORDS);
    expect(chapterReads()).toHaveLength(39);
    expect(chapterReads()).not.toContain(s().manifest!.chapters[0]!.file);
  });

  it("a second count with nothing changed reads nothing", async () => {
    await a().bookWords();
    reads.length = 0;
    expect(await a().bookWords()).toBe(BOOK_WORDS);
    expect(reads).toEqual([]);
  });

  it("typing and saving in the open chapter reads no chapter file, and the count follows the draft", async () => {
    await a().bookWords();
    reads.length = 0;
    const before = countWords(s().currentDoc);
    a().setDraft(para("just three words"));
    expect(await a().bookWords()).toBe(BOOK_WORDS - before + 3);
    await a().flush();
    expect(await a().bookWords()).toBe(BOOK_WORDS - before + 3);
    expect(chapterReads()).toEqual([]);
  });

  it("after editing another chapter, only that chapter is read again", async () => {
    await a().bookWords();
    const [, second] = s().manifest!.chapters;
    await a().selectChapter(second!.id);
    a().setDraft(para("replacement text here now"));
    await a().flush();
    reads.length = 0;
    const was = countWords(BOOK[1]);
    // The first chapter is no longer open, so it is read once; the edited chapter is the open one and is counted from memory.
    expect(await a().bookWords()).toBe(BOOK_WORDS - was + 4);
    expect(chapterReads()).toEqual([s().manifest!.chapters[0]!.file]);
    reads.length = 0;
    expect(await a().bookWords()).toBe(BOOK_WORDS - was + 4);
    expect(reads).toEqual([]);
  });

  it("a replace across the book re-reads only the pages it changed", async () => {
    await a().bookWords();
    const before = await a().readPages();
    const word = "silence";
    const hits = before.filter((p) => JSON.stringify(p.doc).includes(word)).length;
    expect(hits).toBeGreaterThan(1);
    await a().replaceInBook({ query: word, matchCase: false, wholeWord: true }, "hush now");
    reads.length = 0;
    const words = await a().bookWords();
    expect(words).toBeGreaterThan(BOOK_WORDS);
    // At most the changed pages minus the open one are read again.
    expect(chapterReads().length).toBeLessThanOrEqual(hits);
    expect(words).toBe((await a().readPages()).reduce((n, p) => n + countWords(p.doc), 0));
  });

  it("an outside change to another chapter is picked up", async () => {
    await a().bookWords();
    const other = s().manifest!.chapters[5]!;
    const was = countWords(BOOK[5]);
    disk.set(other.file, JSON.stringify(para("one two"), null, 2));
    await a().externalChange(other.file);
    reads.length = 0;
    expect(await a().bookWords()).toBe(BOOK_WORDS - was + 2);
    expect(chapterReads()).toEqual([other.file]);
  });

  it("still rejects a corrupt chapter instead of counting it", async () => {
    const other = s().manifest!.chapters[3]!;
    disk.set(other.file, '{"type":"doc","content":[{"type":"mystery"}]}');
    await expect(a().bookWords()).rejects.toThrow();
  });

  it("books reopened start with an empty cache", async () => {
    await a().bookWords();
    await a().openProject("/p");
    reads.length = 0;
    await a().bookWords();
    expect(chapterReads().length).toBeGreaterThanOrEqual(39);
  });

  it("readPages (print preview, export checks, find) still reads and validates every page: 40 reads, inside a generous budget", async () => {
    reads.length = 0;
    const t0 = performance.now();
    const pages = await a().readPages();
    const ms = performance.now() - t0;
    console.info(
      `[perf] readPages 40 chapters (the pre-fix cost of every word-count refresh): ${ms.toFixed(1)} ms`,
    );
    expect(pages).toHaveLength(40);
    expect(chapterReads()).toHaveLength(40);
    expect(ms).toBeLessThan(3000);
  });

  it("counts 100k words across 40 chapters well inside a generous budget, from cold", async () => {
    const t0 = performance.now();
    await a().bookWords();
    const ms = performance.now() - t0;
    console.info(`[perf] bookWords cold, 40 chapters: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

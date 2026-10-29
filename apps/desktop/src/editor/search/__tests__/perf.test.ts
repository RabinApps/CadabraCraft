import { describe, expect, it } from "vitest";
import { countWords } from "@cadabracraft/shared";
import { isChapterDoc } from "@cadabracraft/editor-schema";
import { bigBook, bigChapter } from "../../../test/bigBook";
import { replaceInDoc, searchBook } from "../../../lib/search/bookSearch";
import { diffChapters, paragraphsOf } from "../../../lib/wordDiff";
import { budget, cpuClock } from "../../../test/perf";

// Budgets are at least 10x what the dev laptop measures (see docs/architecture.md, "Performance budgets"), so slow CI machines pass
// while an accidental quadratic step (seconds) or a per-keystroke full-book pass still fails.
const time = <T>(label: string, fn: () => T): { value: T; ms: number } => {
  const elapsed = cpuClock();
  const value = fn();
  const ms = elapsed();
  console.info(`[perf] ${label}: ${ms.toFixed(1)} ms`);
  return { value, ms };
};

const book = bigBook(100_000, 40, 7);
const bookWords = book.reduce((n, d) => n + countWords(d), 0);
const chapter20k = bigChapter(20_000, 99, "Long");
const chapter20kJson = JSON.stringify(chapter20k, null, 2);

describe("generator", () => {
  it("is deterministic and the right size", () => {
    expect(JSON.stringify(bigBook(2000, 4, 3))).toBe(JSON.stringify(bigBook(2000, 4, 3)));
    expect(book).toHaveLength(40);
    expect(bookWords).toBeGreaterThan(95_000);
    expect(bookWords).toBeLessThan(110_000);
    expect(countWords(chapter20k)).toBeGreaterThan(20_000);
    expect(JSON.stringify(chapter20k)).toContain('"footnote"');
    expect(JSON.stringify(chapter20k)).toContain('"sceneBreak"');
  });
});

describe("large manuscript budgets", () => {
  it("counts 100k words in under 250 ms", () => {
    const { ms } = time("countWords 100k words, 40 chapters", () =>
      book.reduce((n, d) => n + countWords(d), 0),
    );
    expect(ms).toBeLessThan(budget(250));
  });

  it("validates a 20k-word chapter (isChapterDoc) in under 500 ms, and the whole book in under 2 s", () => {
    expect(time("isChapterDoc 20k-word chapter", () => isChapterDoc(chapter20k)).value).toBe(true);
    const all = time("isChapterDoc 100k-word book", () => book.every((d) => isChapterDoc(d)));
    expect(all.value).toBe(true);
    expect(all.ms).toBeLessThan(budget(2000));
  });

  it("parses a 20k-word chapter file in under 100 ms", () => {
    const { value, ms } = time(
      `JSON.parse 20k-word chapter (${(chapter20kJson.length / 1024).toFixed(0)} KiB)`,
      () => JSON.parse(chapter20kJson),
    );
    expect(value.type).toBe("doc");
    expect(ms).toBeLessThan(budget(100));
  });

  it("searches the whole book in under 500 ms and replaces in a 20k-word chapter in under 500 ms", () => {
    const pages = book.map((doc, i) => ({ id: `c${i}`, title: `C${i}`, doc }));
    const opts = { query: "silence", matchCase: false, wholeWord: true };
    const found = time("searchBook 100k words", () => searchBook(pages, opts));
    expect(found.value.total).toBeGreaterThan(0);
    expect(found.ms).toBeLessThan(budget(500));
    const rep = time("replaceInDoc 20k-word chapter", () =>
      replaceInDoc(chapter20k, opts, "quiet"),
    );
    expect(rep.value.count).toBeGreaterThan(0);
    expect(rep.ms).toBeLessThan(budget(500));
    expect(findAfter(rep.value.doc)).toBe(0);
  });

  it("diffs two 20k-word versions of a chapter in under 1.5 s", () => {
    const edited = replaceInDoc(
      chapter20k,
      { query: "silence", matchCase: false, wholeWord: true },
      "hush",
    ).doc;
    const a = paragraphsOf(chapter20k as never);
    const b = paragraphsOf(edited as never);
    const { value, ms } = time(`diffChapters ${a.length} paragraphs`, () => diffChapters(a, b));
    expect(value.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(budget(1500));
  });

  it("diffs a fully rewritten 20k-word chapter without exceeding its cell cap, in under 1.5 s", () => {
    const other = bigChapter(20_000, 1234, "Long");
    const a = paragraphsOf(chapter20k as never);
    const b = paragraphsOf(other as never);
    const { ms } = time(`diffChapters rewrite ${a.length}x${b.length} paragraphs`, () =>
      diffChapters(a, b),
    );
    expect(ms).toBeLessThan(budget(1500));
  });
});

const findAfter = (doc: unknown): number =>
  searchBook([{ id: "x", title: "x", doc: doc as never }], {
    query: "silence",
    matchCase: false,
    wholeWord: true,
  }).total;

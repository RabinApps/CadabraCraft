// measurePages with a fake runner (no typst needed): source generation, file preparation, JSON validation.
import { describe, expect, it } from "vitest";
import { MissingAssetError, PdfExportError, TypstCompileError } from "../errors";
import { measurePages, parsePageReport } from "../measure";
import type { TypstRunner } from "../runner";
import type { PdfChapter } from "../types";

const book = { title: "B", author: "A", language: "en" };
const chapter = (id: string, content: object[]): PdfChapter => ({
  id,
  title: id,
  doc: { type: "doc", content } as PdfChapter["doc"],
});
const text = chapter("c1", [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]);
const report = { total: 3, starts: [{ id: "c1", kind: "chapter", page: 1, end: 1, number: "1" }] };

function fake(over: Partial<TypstRunner> = {}) {
  const queries: { source: string; files: Map<string, Uint8Array>; selector: string }[] = [];
  const compiles: unknown[] = [];
  const runner: TypstRunner = {
    listFonts: async () => ["Libertinus Serif", "New Computer Modern"],
    compile: async (...args) => {
      compiles.push(args);
      return new Uint8Array();
    },
    query: async (source, files, selector) => {
      queries.push({ source, files, selector });
      return JSON.stringify(report);
    },
    ...over,
  };
  return { runner, queries, compiles };
}

describe("measurePages", () => {
  it("queries <page-report> on the generated source and never compiles a PDF", async () => {
    const f = fake();
    expect(await measurePages(book, [text], {}, f.runner)).toEqual(report);
    expect(f.compiles).toHaveLength(0);
    expect(f.queries).toHaveLength(1);
    expect(f.queries[0]!.selector).toBe("<page-report>");
    expect(f.queries[0]!.source).toContain("<page-report>");
    expect(f.queries[0]!.source).toContain('#chapter-start("c1", 1, id: "c1", kind: "chapter")');
  });

  it("passes the same image files as renderPdf and refuses missing assets", async () => {
    const image = chapter("c2", [{ type: "image", attrs: { src: "assets/a.png" } }]);
    const f = fake();
    await measurePages(
      book,
      [image],
      { assets: { "assets/a.png": new Uint8Array([1]) } },
      f.runner,
    );
    expect([...f.queries[0]!.files.keys()]).toHaveLength(1);
    await expect(measurePages(book, [image], {}, f.runner)).rejects.toBeInstanceOf(
      MissingAssetError,
    );
  });

  it("wraps unknown runner errors but keeps export errors", async () => {
    const boom = fake({ query: async () => Promise.reject(new Error("boom")) });
    await expect(measurePages(book, [text], {}, boom.runner)).rejects.toBeInstanceOf(
      TypstCompileError,
    );
    const known = fake({ query: async () => Promise.reject(new PdfExportError("x")) });
    await expect(measurePages(book, [text], {}, known.runner)).rejects.toThrow("x");
  });

  it("rejects a malformed report", async () => {
    const f = fake({ query: async () => '{"total":1}' });
    await expect(measurePages(book, [text], {}, f.runner)).rejects.toThrow(/page report/);
  });
});

describe("measurePages with marks: where inside a word a page begins", () => {
  const starts = [{ id: "c1", kind: "chapter", page: 1, end: 3, number: "1" }];
  const first = JSON.stringify({
    total: 3,
    starts,
    marks: [
      ["s", 0, 0, "p", 1],
      ["w", 31, 2],
      ["s", 0, 1, "h", 2],
      ["w", 4, 3],
      ["s", 0, 2, "k", 3],
      ["l", 5, 3],
    ],
  });
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const text2 = chapter("c1", [
    { type: "paragraph", content: [{ type: "text", text: words }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "aa bb cc dd ee" }] },
    { type: "codeBlock", content: [{ type: "text", text: "a\nb\nc\nd\ne\nf" }] },
  ]);
  /** A runner that answers the first query with `first` and the second with `second`. */
  const twoRuns = (second: string | Error) => {
    let n = 0;
    const queries: { source: string }[] = [];
    const f = fake({
      query: async (source) => {
        queries.push({ source });
        if (n++ === 0) return first;
        if (second instanceof Error) throw second;
        return second;
      },
    });
    return { ...f, queries };
  };
  const withSecond = (marks: unknown, over: object = {}) =>
    JSON.stringify({ total: 3, starts, marks, ...over });
  const run = async (second: string | Error) => {
    const f = twoRuns(second);
    const report = await measurePages(book, [text2], { blockMarks: true }, f.runner);
    return { report, f };
  };
  const splits = (r: { blocks?: Record<string, { splits: unknown[] }[]> }) =>
    r.blocks!.c1!.map((u) => u.splits);

  it("marks the characters of the words a page began with, and says where in the word the page began", async () => {
    const { report, f } = await run(
      withSecond([
        ["s", 0, 0, "p", 1],
        ["c", 0, 0, 0, 30, 4, 2],
        ["c", 0, 0, 0, 30, 5, 2],
        ["s", 0, 1, "h", 2],
        ["c", 0, 1, 0, 3, 1, 3],
      ]),
    );
    expect(f.queries).toHaveLength(2);
    // The second run asks for exactly those words, and has no word marks.
    expect(f.queries[1]!.source).toContain("#cm(0, 0, 0, 30, 1)");
    expect(f.queries[1]!.source).toContain("#cm(0, 1, 0, 3, 1)");
    expect(f.queries[1]!.source).not.toContain("#wm(");
    // A mark first seen on the page at its 4th character: the page began at the 3rd. At the 1st: at the word.
    expect(splits(report)).toEqual([
      [{ word: 30, page: 2, char: 3 }],
      [{ word: 3, page: 3 }],
      [{ word: 3, page: 3 }],
    ]);
  });

  it("keeps the words when the second run came out different, failed, or says nothing usable", async () => {
    const plain = [[{ word: 30, page: 2 }], [{ word: 3, page: 3 }], [{ word: 3, page: 3 }]];
    const c = ["c", 0, 0, 0, 30, 4, 2];
    for (const second of [
      withSecond([c], { total: 4 }),
      JSON.stringify({ total: 3, starts: [{ ...starts[0], end: 2 }], marks: [c] }),
      JSON.stringify({ total: 3, starts: [], marks: [c] }),
      new Error("boom"),
      "not json",
      withSecond([["c", 0, 0, 0, "x", 4, 2]]),
      withSecond([["w", 3, 2], 5]),
      withSecond([["c", 0, 0, 0, 30, 4, 3]]),
      withSecond(undefined),
      withSecond([["c", 0, 0, 0, 29, 4, 2]]),
    ]) {
      const { report } = await run(second);
      expect(splits(report)).toEqual(plain);
    }
  });

  it("asks nothing more when no page began inside a text leaf, or marks were not asked for", async () => {
    const f = fake({
      query: async () =>
        JSON.stringify({
          total: 3,
          starts,
          marks: [
            ["s", 0, 0, "p", 1],
            ["s", 0, 1, "k", 2],
            ["l", 3, 3],
          ],
        }),
    });
    await measurePages(book, [text2], { blockMarks: true }, f.runner);
    expect(f.queries).toHaveLength(0);
    const g = fake();
    await measurePages(book, [text2], {}, g.runner);
    expect(g.queries).toHaveLength(1);
  });

  it("copes with a page entry that has no marks of its own", async () => {
    const two = [...starts, { id: "c2", kind: "chapter", page: 4, end: 4, number: "4" }];
    const f = fake({
      query: async (source) =>
        source.includes("#cm(")
          ? JSON.stringify({ total: 4, starts: two, marks: [["c", 0, 0, 0, 30, 4, 2]] })
          : JSON.stringify({ total: 4, starts: two, marks: JSON.parse(first).marks }),
    });
    const r = await measurePages(book, [text2, chapter("c2", [])], { blockMarks: true }, f.runner);
    expect(r.blocks!.c1![0]!.splits).toEqual([{ word: 30, page: 2, char: 3 }]);
    expect(r.blocks!.c2).toBeUndefined();
  });

  it("uses the first mark on a page and ignores the later ones", async () => {
    const { report } = await run(
      withSecond([
        ["c", 0, 0, 0, 30, 6, 2],
        ["c", 0, 0, 0, 30, 7, 2],
      ]),
    );
    expect(splits(report)[0]).toEqual([{ word: 30, page: 2, char: 5 }]);
  });
});

describe("parsePageReport", () => {
  it("accepts the documented shape", () => {
    expect(parsePageReport(JSON.stringify({ total: 0, starts: [] }))).toEqual({
      total: 0,
      starts: [],
    });
  });
  it.each([
    ["not json", "nope"],
    ["an array", "[]"],
    ["null", "null"],
    ["missing starts", '{"total":1}'],
    ["fractional total", '{"total":1.5,"starts":[]}'],
    ["start not an object", '{"total":1,"starts":[1]}'],
    [
      "start with a numeric number",
      '{"total":1,"starts":[{"id":"a","kind":"k","page":1,"end":1,"number":1}]}',
    ],
    ["start without an end", '{"total":1,"starts":[{"id":"a","kind":"k","page":1,"number":""}]}'],
    [
      "start that ends before it begins",
      '{"total":3,"starts":[{"id":"a","kind":"k","page":2,"end":1,"number":""}]}',
    ],
    [
      "start with a bad page",
      '{"total":1,"starts":[{"id":"a","kind":"k","page":"1","end":1,"number":""}]}',
    ],
  ])("rejects %s", (_name, json) => {
    expect(() => parsePageReport(json)).toThrow(PdfExportError);
  });
});

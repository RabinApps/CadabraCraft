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
const report = { total: 3, starts: [{ id: "c1", kind: "chapter", page: 1, number: "1" }] };

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
      '{"total":1,"starts":[{"id":"a","kind":"k","page":1,"number":1}]}',
    ],
    [
      "start with a bad page",
      '{"total":1,"starts":[{"id":"a","kind":"k","page":"1","number":""}]}',
    ],
  ])("rejects %s", (_name, json) => {
    expect(() => parsePageReport(json)).toThrow(PdfExportError);
  });
});

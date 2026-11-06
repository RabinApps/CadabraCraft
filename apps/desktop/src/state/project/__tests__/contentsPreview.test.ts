import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

const typst = {
  failWith: null as unknown,
  compiles: [] as string[],
  queries: [] as string[],
  report: (_id: string) => "",
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    typstListFonts: async () => ["Libertinus Serif", "New Computer Modern", "Lora"],
    typstQuery: async (source: string) => {
      typst.queries.push(source);
      if (typst.failWith) throw typst.failWith;
      const id = /contents-page\("([^"]+)"/.exec(source)?.[1] ?? "";
      return typst.report(id);
    },
    typstCompile: async (source: string) => {
      typst.compiles.push(source);
      if (typst.failWith) throw typst.failWith;
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    },
  }),
);

import { PdfUiError } from "../../../lib/export/pdfErrors";
import { CONTENTS_CACHE_SIZE } from "../output/contentsPreview";
import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();

let books = 0;
beforeEach(async () => {
  disk.clear();
  typst.failWith = null;
  typst.compiles = [];
  typst.queries = [];
  typst.report = (id) =>
    JSON.stringify({
      total: 6,
      starts: [{ id, kind: "contents", page: 3, end: 4, number: "iii" }],
    });
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
    exportStage: null,
  });
  // The store (and its cache) outlives a test, so each book is its own.
  await a().createProject("/p", `Book ${++books}`, "Me");
});

describe("renderContentsPreview", () => {
  it("typesets the book with the list, and answers with the pdf, the contents pages and the trim size", async () => {
    await a().addMatter("front", "contents");
    const result = await a().renderContentsPreview();
    expect(result).toMatchObject({ kind: "typst", first: 3, last: 4 });
    if (result.kind !== "typst") throw new Error("typst");
    expect(result.trim).toEqual({ w: 5.5, h: 8.5 });
    expect(result.pdf).toBeInstanceOf(Uint8Array);
    // The layout run and the pdf run are the same book: the list is in both, and no cover or bleed.
    expect(typst.queries).toHaveLength(1);
    expect(typst.compiles).toHaveLength(1);
    expect(typst.compiles[0]).toContain("toc-list(");
    expect(typst.compiles[0]).toBe(typst.queries[0]);
  });

  it("reuses the result while the book is unchanged and typesets again when the list changes", async () => {
    await a().addMatter("front", "contents");
    const id = s().manifest!.frontMatter[0]!.id;
    const first = await a().renderContentsPreview();
    expect(await a().renderContentsPreview()).toBe(first);
    expect(typst.compiles).toHaveLength(1);
    await a().renameTocItem(id, s().manifest!.chapters[0]!.id, "Renamed");
    const second = await a().renderContentsPreview();
    expect(second).not.toBe(first);
    expect(second.kind === "typst" && second.key).not.toBe(first.kind === "typst" && first.key);
    expect(typst.compiles).toHaveLength(2);
    expect(typst.compiles[1]).toContain('title: "Renamed"');
  });

  it("takes the page range from the status bar's measure of the same text instead of measuring again", async () => {
    await a().addMatter("front", "contents");
    await a().measurePages();
    expect(typst.queries).toHaveLength(1);
    await a().renderContentsPreview();
    expect(typst.queries).toHaveLength(1);
    expect(typst.compiles).toHaveLength(1);
    // The other way round: a measure after the preview finds the report the preview left.
    await a().measurePages();
    expect(typst.queries).toHaveLength(1);
  });

  it("runs one measure when the status bar and the preview ask at the same time, and again only when the text changes", async () => {
    await a().addMatter("front", "contents");
    const id = s().manifest!.frontMatter[0]!.id;
    await Promise.all([a().measurePages(), a().renderContentsPreview(), a().measurePages()]);
    expect(typst.queries).toHaveLength(1);
    await a().renameTocItem(id, s().manifest!.chapters[0]!.id, "Another");
    await Promise.all([a().renderContentsPreview(), a().measurePages()]);
    expect(typst.queries).toHaveLength(2);
  });

  it("keeps the last few results, most recently used last", async () => {
    await a().addMatter("front", "contents");
    const id = s().manifest!.frontMatter[0]!.id;
    const chapter = s().manifest!.chapters[0]!.id;
    const results = [await a().renderContentsPreview()];
    for (let i = 0; i < CONTENTS_CACHE_SIZE; i++) {
      await a().renameTocItem(id, chapter, `Title ${i}`);
      results.push(await a().renderContentsPreview());
    }
    const runs = typst.compiles.length;
    // The newest are still there; the oldest was dropped.
    expect(await a().renderContentsPreview()).toBe(results.at(-1));
    expect(typst.compiles).toHaveLength(runs);
    await a().renameTocItem(id, chapter, "Title 1");
    expect(await a().renderContentsPreview()).toBe(results[2]);
    expect(typst.compiles).toHaveLength(runs);
    await a().resetToc(id);
    expect(await a().renderContentsPreview()).not.toBe(results[0]);
    expect(typst.compiles).toHaveLength(runs + 1);
  });

  it("says Typst is unavailable instead of failing when it is not installed", async () => {
    await a().addMatter("front", "contents");
    typst.failWith = { kind: "not_found", message: "no typst" };
    expect(await a().renderContentsPreview()).toEqual({ kind: "unavailable" });
  });

  it("fails with a message for the author when the book does not compile", async () => {
    await a().addMatter("front", "contents");
    typst.failWith = { kind: "compile", message: "error: unclosed delimiter" };
    const error = await a()
      .renderContentsPreview()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfUiError);
    expect((error as PdfUiError).code).toBe("compile");
  });

  it("fails when the book has no contents page", async () => {
    await expect(a().renderContentsPreview()).rejects.toThrow(/no contents page/);
  });

  it("fails when Typst's layout does not have the contents page", async () => {
    await a().addMatter("front", "contents");
    typst.report = () => JSON.stringify({ total: 1, starts: [] });
    await expect(a().renderContentsPreview()).rejects.toThrow(/not in the typeset book/);
  });
});

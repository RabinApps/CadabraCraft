import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

const assets = new Map<string, Uint8Array>();
const typst = {
  failWith: null as unknown,
  compiles: [] as { source: string; files: [string, Uint8Array][]; pdfA: boolean }[],
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readAsset: async (_r: string, p: string) => {
      const b = assets.get(p);
      if (!b) throw new Error("missing");
      return b;
    },
    typstListFonts: async () => ["Libertinus Serif", "New Computer Modern"],
    typstCompile: async (source: string, files: [string, Uint8Array][], pdfA: boolean) => {
      typst.compiles.push({ source, files, pdfA });
      if (typst.failWith) throw typst.failWith;
      return new Uint8Array([0x25, 0x50, 0x44, 0x46, typst.compiles.length]);
    },
  }),
);

import { sourceEdition } from "@cadabracraft/format";
import { PdfUiError } from "../../../lib/pdfErrors";
import { PREVIEW_CACHE_SIZE } from "../preview";
import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const source = () => typst.compiles.at(-1)!.source;

beforeEach(async () => {
  disk.clear();
  assets.clear();
  typst.failWith = null;
  typst.compiles = [];
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    exportStage: null,
  });
  await a().createProject("/p", "Book", "Me");
});

describe("renderPreview", () => {
  it("typesets the open page's draft with the book's trim size, without writing a file or taking the export lock", async () => {
    a().setDraft({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "on screen only" }] }],
    });
    const pdf = await a().renderPreview({});
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(typst.compiles).toHaveLength(1);
    expect(typst.compiles[0]!.pdfA).toBe(false);
    expect(source()).toContain("on screen only");
    expect(s().exportStage).toBeNull();
    expect([...disk.keys()].some((k) => k.startsWith("exports/"))).toBe(false);
  });

  it("uses the trim size and bleed it is given", async () => {
    await a().renderPreview({ trimSize: "5x8", bleedIn: 0.125 });
    expect(source()).toMatch(/#set page\(width: 5\.125in, height: 8\.25in/);
    await a().renderPreview({ trimSize: "5x8", bleedIn: 0.125, cropMarks: true });
    expect(source()).toMatch(/#set page\(width: 5\.75in, height: 8\.75in/);
    expect(source()).toContain("foreground:");
  });

  it("reuses a result while the content and options are the same and typesets again after a change", async () => {
    const first = await a().renderPreview({ trimSize: "6x9" });
    expect(await a().renderPreview({ trimSize: "6x9" })).toBe(first);
    expect(typst.compiles).toHaveLength(1);
    await a().renderPreview({ trimSize: "6x9", bleedIn: 0.125 });
    expect(typst.compiles).toHaveLength(2);
    // Going back is free: the first one is still kept.
    expect(await a().renderPreview({ trimSize: "6x9" })).toBe(first);
    expect(typst.compiles).toHaveLength(2);
    await a().add("More");
    await a().renderPreview({ trimSize: "6x9" });
    expect(typst.compiles).toHaveLength(3);
  });

  it("keeps only the most recent few", async () => {
    const sizes = ["5x8", "5.5x8.5", "6x9", "7x10"] as const;
    expect(PREVIEW_CACHE_SIZE).toBe(3);
    for (const trimSize of sizes) await a().renderPreview({ trimSize });
    expect(typst.compiles).toHaveLength(4);
    await a().renderPreview({ trimSize: "7x10" });
    expect(typst.compiles).toHaveLength(4);
    await a().renderPreview({ trimSize: "5x8" }); // the oldest was dropped
    expect(typst.compiles).toHaveLength(5);
  });

  it("puts the cover first, and stops with a message when its file is missing", async () => {
    const e = sourceEdition(s().manifest!.editions);
    await a().updateDetails({
      title: e.title,
      author: e.author,
      language: e.language,
      identifier: e.identifier,
      isbn: "",
      cover: "assets/front.png",
    });
    await expect(a().renderPreview({})).rejects.toThrow(/cover image assets\/front\.png/);
    assets.set("assets/front.png", new Uint8Array([1, 2, 3]));
    await a().renderPreview({});
    expect(source()).toContain("#page(margin: 0pt, header: none, footer: none)");
  });

  it("turns a Typst failure into a message for the author", async () => {
    typst.failWith = { kind: "not_found", message: "no typst" };
    const err = await a()
      .renderPreview({})
      .then(
        () => null,
        (x: unknown) => x,
      );
    expect(err).toBeInstanceOf(PdfUiError);
    expect((err as PdfUiError).code).toBe("typst-missing");
  });

  it("refuses when no book is open", async () => {
    useProject.setState({ root: null, manifest: null });
    await expect(a().renderPreview({})).rejects.toBeInstanceOf(PdfUiError);
  });
});

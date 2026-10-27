import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

const bytesOnDisk = new Map<string, Uint8Array>();
const assets = new Map<string, Uint8Array>();
const typst = {
  fonts: ["Libertinus Serif", "New Computer Modern"],
  failWith: null as unknown,
  compiles: [] as { path: string | null; source: string; files: [string, Uint8Array][]; pdfA: boolean }[],
};
vi.mock("../../../lib/bridge", async () => (await import("../../../test/fakeBridge")).fakeBridge({
  writeBytes: async (_r: string, p: string, b: Uint8Array) => { bytesOnDisk.set(p, b); },
  readAsset: async (_r: string, p: string) => { const b = assets.get(p); if (!b) throw new Error("missing"); return b; },
  typstListFonts: async () => {
    if (typst.failWith) throw typst.failWith;
    return typst.fonts;
  },
  typstCompile: async (path: string | null, source: string, files: [string, Uint8Array][], pdfA: boolean) => {
    typst.compiles.push({ path, source, files, pdfA });
    if (typst.failWith) throw typst.failWith;
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  },
}));

import { PdfUiError } from "../../../lib/pdfErrors";
import { useProject } from "../../store";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const options = { trimSize: "5.5x8.5" as const, pdfA: true, template: "nonfiction" };

beforeEach(async () => {
  disk.clear();
  bytesOnDisk.clear();
  assets.clear();
  typst.fonts = ["Libertinus Serif", "New Computer Modern"];
  typst.failWith = null;
  typst.compiles = [];
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0, exportStage: null });
  await a().createProject("/p", "Book", "Me");
});

const fail = async (): Promise<PdfUiError> => {
  const e = await a().exportPdf(options).then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(PdfUiError);
  return e as PdfUiError;
};

describe("exportPdf with a cover", () => {
  const setCover = () => a().updateDetails({ ...s().manifest!, isbn: "", cover: "assets/front.png" });
  const source = () => typst.compiles.at(-1)!.source;
  it("sends the cover image to Typst as the first page", async () => {
    assets.set("assets/front.png", new Uint8Array([1, 2, 3]));
    await setCover();
    await a().exportPdf(options);
    expect(source()).toContain("#page(margin: 0pt, header: none, footer: none)");
    expect(typst.compiles.at(-1)!.files.map(([p]) => p)).toContain("assets/img-1.png");
  });
  it("leaves it out when asked, without needing the file", async () => {
    await setCover();
    await a().exportPdf({ ...options, cover: false });
    expect(source()).not.toContain("margin: 0pt, header: none");
  });
  it("stops with a message when the cover file is missing", async () => {
    await setCover();
    const e = await fail();
    expect(e.message).toMatch(/cover image assets\/front\.png could not be read/);
    expect(typst.compiles).toHaveLength(0);
  });
});

describe("exportPdf", () => {
  it("flushes the draft, compiles with the chosen options and writes exports/book.pdf", async () => {
    a().setDraft({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "typed but not saved" }] }] });
    await a().exportPdf({ ...options, typstPath: " /opt/typst " });
    expect(typst.compiles).toHaveLength(1);
    const c = typst.compiles[0]!;
    expect(c.pdfA).toBe(true);
    expect(c.path).toBe("/opt/typst");
    expect(c.source).toContain("typed but not saved");
    expect(c.source).toMatch(/5\.5in/); // trim size reached the generated source
    expect(bytesOnDisk.get("exports/book.pdf")).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(s().notice).toBe("Exported exports/book.pdf");
    expect(s().exportStage).toBeNull();
    expect(s().draft).toBeNull();
  });
  it("saves a changed template in the manifest, and leaves it alone when unchanged", async () => {
    await a().exportPdf(options);
    expect(s().manifest!.template).toBe("nonfiction");
    expect(JSON.parse(disk.get("cadabra.json")!).template).toBe("nonfiction");
    const before = disk.get("cadabra.json");
    await a().exportPdf(options);
    expect(disk.get("cadabra.json")).toBe(before);
  });
  it("includes front and back matter in reading order with their layouts and numbering", async () => {
    await a().addMatter("front", "title-page");
    await a().addMatter("front", "dedication");
    await a().addMatter("back", "about-the-author");
    await a().exportPdf(options);
    const src = typst.compiles[0]!.source;
    expect(src).toContain("#title-page[");
    expect(src).toContain("#centered-page[");
    expect(src).toContain('numbering: "i"');
    expect(src).toContain('#chapter-start("About the Author", none)');
    expect(src.indexOf("#title-page[")).toBeLessThan(src.indexOf('#chapter-start("Chapter One", 1)'));
    expect(src.indexOf('#chapter-start("Chapter One", 1)')).toBeLessThan(src.indexOf('#chapter-start("About the Author", none)'));
  });
  it("sends image files to the compiler", async () => {
    assets.set("assets/pic.png", new Uint8Array([9, 8, 7]));
    disk.set("manuscript/001-chapter-one.json", JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "assets/pic.png" } }] }));
    await a().exportPdf(options);
    expect(typst.compiles[0]!.files).toHaveLength(1);
    expect([...typst.compiles[0]!.files[0]![1]]).toEqual([9, 8, 7]);
  });
  it("reports typst missing with install advice and writes nothing", async () => {
    typst.failWith = { kind: "not_found", message: 'The "typst" program was not found. Install Typst (brew install typst).' };
    const e = await fail();
    expect(e.code).toBe("typst-missing");
    expect(e.message).toContain("brew install typst");
    expect(bytesOnDisk.size).toBe(0);
    expect(s().exportStage).toBeNull();
  });
  it("names a missing font and does not compile", async () => {
    typst.fonts = ["Something Else"];
    const e = await fail();
    expect(e.code).toBe("font");
    expect(e.message).toContain("Libertinus Serif");
    expect(typst.compiles).toHaveLength(0);
    expect(bytesOnDisk.size).toBe(0);
  });
  it("shows Typst's compile error text", async () => {
    typst.failWith = null;
    const orig = typst.compiles;
    // listFonts succeeds; compile fails
    const bridgeMod = await import("../../../lib/bridge");
    const spy = vi.spyOn(bridgeMod.bridge, "typstCompile").mockRejectedValueOnce({ kind: "compile", message: "main.typ:3:1: error: unknown variable" });
    const e = await fail();
    spy.mockRestore();
    expect(e.code).toBe("compile");
    expect(e.message).toContain("main.typ:3:1: error: unknown variable");
    expect(orig).toHaveLength(0);
  });
  it("reports a timeout", async () => {
    const bridgeMod = await import("../../../lib/bridge");
    const spy = vi.spyOn(bridgeMod.bridge, "typstCompile").mockRejectedValueOnce({ kind: "timeout", seconds: 120 });
    const e = await fail();
    spy.mockRestore();
    expect(e.code).toBe("timeout");
    expect(e.message).toContain("120 seconds");
  });
  it("fails clearly when an image file is missing", async () => {
    disk.set("manuscript/001-chapter-one.json", JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "assets/gone.png" } }] }));
    const e = await fail();
    expect(e.message).toContain("assets/gone.png");
    expect(typst.compiles).toHaveLength(0);
    expect(bytesOnDisk.size).toBe(0);
  });
  it("falls back to the default template for an unknown id", async () => {
    await a().exportPdf({ ...options, template: "no-such-template" });
    expect(s().manifest!.template).toBe("novel");
  });
});

describe("exportMarkdown", () => {
  const underlined = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi", marks: [{ type: "underline" }] }] }] };
  const text = () => new TextDecoder().decode(bytesOnDisk.get("exports/book.md")!);
  it("writes exports/book.md and sets the notice", async () => {
    disk.set("manuscript/001-chapter-one.json", JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello there" }] }] }));
    await a().exportMarkdown({ htmlMarks: false });
    expect(text()).toContain("Hello there");
    expect(s().notice).toBe("Exported exports/book.md");
    expect(s().exportStage).toBeNull();
  });
  it("stops at an underline, naming the chapter, when htmlMarks is off, and writes nothing", async () => {
    disk.set("manuscript/001-chapter-one.json", JSON.stringify(underlined));
    const e = await a().exportMarkdown({ htmlMarks: false }).then(() => null, (x: unknown) => x);
    expect((e as Error).message).toContain("Chapter One");
    expect(bytesOnDisk.has("exports/book.md")).toBe(false);
    expect(s().exportStage).toBeNull();
  });
  it("writes underline as HTML when htmlMarks is on", async () => {
    disk.set("manuscript/001-chapter-one.json", JSON.stringify(underlined));
    await a().exportMarkdown({ htmlMarks: true });
    expect(text()).toContain("<u>Hi</u>");
  });
});

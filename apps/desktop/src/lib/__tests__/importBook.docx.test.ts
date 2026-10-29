import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../test/fakeBridge";

/** What the (faked) Rust command is asked, and what it answers: a framed reply, or a rejection. */
const state = vi.hoisted(() => ({
  asked: [] as { path: string; level: number }[],
  reads: [] as string[],
  reply: null as Uint8Array | null,
  fail: null as unknown,
}));

vi.mock("../bridge", async () =>
  (await import("../../test/fakeBridge")).fakeBridge({
    readImportSource: async (p: string) => {
      state.reads.push(p);
      return new Uint8Array();
    },
    importDocxSource: async (path: string, level: number) => {
      state.asked.push({ path, level });
      if (state.fail) throw state.fail;
      return state.reply!;
    },
    readImportImage: async () => {
      throw new Error("no image");
    },
    importAssetBytes: async (_r: string, name: string) => `assets/${name}`,
  }),
);

import { loadImport, parseImport, runImport } from "../importBook";

const PNG = [1, 2, 3, 4];
const doc = (text: string) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] },
    { type: "image", attrs: { src: "assets/a.png", alt: null, title: null } },
  ],
});

function frame(chapters: unknown[], assets: unknown[] = [], bytes: number[] = []): Uint8Array {
  const h = new TextEncoder().encode(JSON.stringify({ chapters, warnings: [], assets }));
  const out = new Uint8Array(4 + h.length + bytes.length);
  new DataView(out.buffer).setUint32(0, h.length, true);
  out.set(h, 4);
  out.set(bytes, 4 + h.length);
  return out;
}
const withImage = () =>
  frame(
    [{ title: "One", doc: doc("One") }],
    [
      {
        sourcePath: "word/media/a.png",
        targetPath: "assets/a.png",
        mediaType: "image/png",
        len: PNG.length,
      },
    ],
    PNG,
  );

beforeEach(() => {
  disk.clear();
  state.asked = [];
  state.reads = [];
  state.reply = withImage();
  state.fail = null;
});

describe("a .docx import goes through the Rust command", () => {
  it("does not read the file in the webview: only its path is kept", async () => {
    const loaded = await loadImport("/src/Book.DOCX");
    expect(loaded).toEqual({ ext: "docx", bytes: new Uint8Array(), path: "/src/Book.DOCX" });
    expect(state.reads).toEqual([]);
  });

  it("asks for the chosen split level and returns chapters with the image bytes", async () => {
    const loaded = await loadImport("/src/book.docx");
    const r = await parseImport(loaded, 2);
    expect(state.asked).toEqual([{ path: "/src/book.docx", level: 2 }]);
    expect(r.chapters.map((c) => c.title)).toEqual(["One"]);
    expect(Array.from(r.assets[0]!.bytes!)).toEqual(PNG);
    await parseImport(loaded);
    expect(state.asked[1]!.level).toBe(1);
  });

  it("describes the importer's refusals in the author's words", async () => {
    const loaded = await loadImport("/src/book.docx");
    state.fail = { kind: "import_docx", code: "invalid-zip" };
    await expect(parseImport(loaded)).rejects.toThrow(/valid \.docx/);
    state.fail = { kind: "import_docx", code: "archive-too-large" };
    await expect(parseImport(loaded)).rejects.toThrow(/too large to import safely/);
  });

  it("passes any other failure through", async () => {
    const loaded = await loadImport("/src/book.docx");
    state.fail = { kind: "not_picked", name: "book.docx" };
    await expect(parseImport(loaded)).rejects.toEqual({ kind: "not_picked", name: "book.docx" });
    state.fail = new Error("boom");
    await expect(parseImport(loaded)).rejects.toThrow("boom");
  });

  it("refuses a document with no text", async () => {
    state.reply = frame([]);
    await expect(parseImport(await loadImport("/src/book.docx"))).rejects.toThrow(/no text/);
  });

  it("calls the command with an empty path when the source has none (never reached by the app)", async () => {
    await parseImport({ ext: "docx", bytes: new Uint8Array() });
    expect(state.asked).toEqual([{ path: "", level: 1 }]);
  });

  it("imports a whole book from the reply: chapter files and the image are stored", async () => {
    const report = await runImport({
      sourcePath: "/src/book.docx",
      root: "/new",
      title: "T",
      author: "A",
    });
    expect(report).toMatchObject({ fileName: "book.docx", chapterCount: 1, imageCount: 1 });
    const chapter = [...disk.entries()].find(([k]) => k.startsWith("manuscript/"));
    expect(chapter?.[1]).toContain("assets/a.png");
  });
});

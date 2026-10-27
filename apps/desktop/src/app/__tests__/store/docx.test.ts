import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { disk } from "../../../test/fakeBridge";

let writeBytesError: Error | null = null;
let exported: { path: string; bytes: Uint8Array } | null = null;
vi.mock("../../../lib/bridge", async () => (await import("../../../test/fakeBridge")).fakeBridge({
  writeBytes: async (_r: string, p: string, b: Uint8Array) => {
    if (writeBytesError) throw writeBytesError;
    exported = { path: p, bytes: b };
  },
  readAsset: async (_r: string, src: string) => { if (src.endsWith(".svg")) return new Uint8Array(4); throw new Error("missing"); },
}));

import { useProject } from "../../store";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const doc = (...content: unknown[]) => ({ type: "doc" as const, content: content as never });
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const part = (name: string) => strFromU8(unzipSync(exported!.bytes)[name]!);

beforeEach(async () => {
  disk.clear();
  exported = null;
  writeBytesError = null;
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0, trash: [], exportStage: null });
  await a().createProject("/p", "Book", "Ada Lovelace");
});

describe("exportDocx", () => {
  it("writes exports/manuscript.docx and reports it", async () => {
    await a().saveCurrent(doc(p("Hello manuscript")));
    await a().exportDocx({ font: "times" });
    expect(exported!.path).toBe("exports/manuscript.docx");
    expect(part("word/document.xml")).toContain("Hello manuscript");
    expect(part("word/header2.xml")).toContain("Lovelace / BOOK / ");
    expect(s().notice).toBe("Exported exports/manuscript.docx");
    expect(s().exportStage).toBeNull();
  });
  it("passes the font choice through", async () => {
    await a().exportDocx({ font: "courier" });
    expect(part("word/styles.xml")).toContain('w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia');
  });
  it("names the page that cannot be written and writes nothing", async () => {
    await a().saveCurrent(doc({ type: "image", attrs: { src: "assets/a.svg", alt: "x" } }));
    const err = await a().exportDocx({ font: "times" }).catch((e: Error) => e);
    expect((err as Error).message).toContain("Chapter One");
    expect((err as Error).message).toContain("SVG");
    expect(exported).toBeNull();
    expect(s().exportStage).toBeNull();
    expect(s().notice).not.toMatch(/Exported/);
  });
  it("names the file when the failing page has an empty title", async () => {
    const entry = s().manifest!.chapters[0]!;
    useProject.setState({ manifest: { ...s().manifest!, chapters: [{ ...entry, title: "" }] } });
    await a().saveCurrent(doc({ type: "image", attrs: { src: "assets/a.svg", alt: "x" } }));
    const err = await a().exportDocx({ font: "times" }).catch((e: Error) => e);
    expect((err as Error).message).toContain(entry.file);
  });
  it("a missing image stops the export with its name", async () => {
    await a().saveCurrent(doc({ type: "image", attrs: { src: "assets/x.png", alt: "x" } }));
    await expect(a().exportDocx({ font: "times" })).rejects.toThrow(/assets\/x\.png/);
    expect(exported).toBeNull();
  });
  it("a write failure rejects with the reason, sets no success notice and leaves the store usable", async () => {
    writeBytesError = new Error("No space left on device");
    await expect(a().exportDocx({ font: "times" })).rejects.toThrow(/No space left/);
    expect(s().exportStage).toBeNull();
    expect(s().notice).not.toMatch(/Exported/);
    writeBytesError = null;
    await a().exportDocx({ font: "times" });
    expect(s().notice).toMatch(/Exported exports\/manuscript\.docx/);
  });
  it("refuses a second export while one runs", async () => {
    const first = a().exportDocx({ font: "times" });
    await expect(a().exportDocx({ font: "times" })).rejects.toThrow(/already running/);
    await first;
  });
  it("refuses a book with no pages", async () => {
    useProject.setState({ manifest: { ...s().manifest!, chapters: [] } });
    await expect(a().exportDocx({ font: "times" })).rejects.toThrow(/no pages/);
    expect(exported).toBeNull();
  });
});

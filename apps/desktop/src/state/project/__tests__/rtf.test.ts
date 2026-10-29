import { sourceFile } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

let writeBytesError: Error | null = null;
let exported: { path: string; bytes: Uint8Array } | null = null;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      if (writeBytesError) throw writeBytesError;
      exported = { path: p, bytes: b };
    },
    readAsset: async (_r: string, src: string) => {
      if (src.endsWith(".gif")) return new Uint8Array(16);
      throw new Error("missing");
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const doc = (...content: unknown[]) => ({ type: "doc" as const, content: content as never });
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const text = () => new TextDecoder().decode(exported!.bytes);

beforeEach(async () => {
  disk.clear();
  exported = null;
  writeBytesError = null;
  useProject.setState({
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
  await a().createProject("/p", "Book", "Ada Lovelace");
});

describe("exportRtf", () => {
  it("writes exports/en/manuscript.rtf and reports it", async () => {
    await a().saveCurrent(doc(p("Hello manuscript")));
    await a().exportRtf({ font: "times" });
    expect(exported!.path).toBe("exports/en/manuscript.rtf");
    expect(text().startsWith("{\\rtf1")).toBe(true);
    expect(text()).toContain("Hello manuscript");
    expect(text()).toContain("Lovelace / BOOK / ");
    expect(s().notice).toBe("Exported exports/en/manuscript.rtf");
    expect(s().exportStage).toBeNull();
  });
  it("passes the font choice through", async () => {
    await a().exportRtf({ font: "courier" });
    expect(text()).toContain("{\\f0\\fmodern\\fcharset0 Courier New;}");
    await a().exportRtf({ font: "Lora" });
    expect(text()).toContain("{\\f0\\fnil\\fcharset0 Lora;}");
  });
  it("names the page that cannot be written and writes nothing", async () => {
    await a().saveCurrent(doc({ type: "image", attrs: { src: "assets/a.gif", alt: "x" } }));
    const err = await a()
      .exportRtf({ font: "times" })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("Chapter One");
    expect((err as Error).message).toContain("PNG or JPEG");
    expect(exported).toBeNull();
    expect(s().exportStage).toBeNull();
    expect(s().notice).not.toMatch(/Exported/);
  });
  it("names the file when the failing page has an empty title", async () => {
    const entry = s().manifest!.chapters[0]!;
    useProject.setState({
      manifest: { ...s().manifest!, chapters: [{ ...entry, titles: { en: "" } }] },
    });
    await a().saveCurrent(doc({ type: "image", attrs: { src: "assets/a.gif", alt: "x" } }));
    const err = await a()
      .exportRtf({ font: "times" })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain(sourceFile(entry, s().manifest!.editions));
  });
  it("a missing image stops the export with its name", async () => {
    await a().saveCurrent(doc({ type: "image", attrs: { src: "assets/x.png", alt: "x" } }));
    await expect(a().exportRtf({ font: "times" })).rejects.toThrow(/assets\/x\.png/);
    expect(exported).toBeNull();
  });
  it("a write failure rejects with the reason, sets no success notice and leaves the store usable", async () => {
    writeBytesError = new Error("No space left on device");
    await expect(a().exportRtf({ font: "times" })).rejects.toThrow(/No space left/);
    expect(s().exportStage).toBeNull();
    expect(s().notice).not.toMatch(/Exported/);
    writeBytesError = null;
    await a().exportRtf({ font: "times" });
    expect(s().notice).toMatch(/Exported exports\/en\/manuscript\.rtf/);
  });
  it("refuses a second export while one runs, Word or Rich Text", async () => {
    const first = a().exportRtf({ font: "times" });
    const again = a().exportRtf({ font: "times" });
    const word = a().exportDocx({ font: "times" });
    await expect(again).rejects.toThrow(/already running/);
    await expect(word).rejects.toThrow(/already running/);
    await first;
  });
  it("refuses a book with no pages", async () => {
    useProject.setState({ manifest: { ...s().manifest!, chapters: [] } });
    await expect(a().exportRtf({ font: "times" })).rejects.toThrow(/no pages/);
    expect(exported).toBeNull();
  });
});

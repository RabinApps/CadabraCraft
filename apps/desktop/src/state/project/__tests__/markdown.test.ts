import { sourceFile } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

let writeBytesError: Error | null = null;
let exported: string | null = null;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      if (writeBytesError) throw writeBytesError;
      exported = new TextDecoder().decode(b);
      disk.set(p, exported);
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const doc = (...content: unknown[]) => ({ type: "doc" as const, content: content as never });
const p = (text: string, marks?: { type: string }[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

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
  await a().createProject("/p", "Book", "Me");
});

describe("exportMarkdown failure handling", () => {
  it("shows the file name when the failing page has an empty title", async () => {
    const entry = s().manifest!.chapters[0]!;
    useProject.setState({
      manifest: { ...s().manifest!, chapters: [{ ...entry, titles: { en: "" } }] },
    });
    a().setDraft(doc(p("bold", [{ type: "underline" }])));
    await a().saveCurrent(doc(p("x", [{ type: "underline" }])));
    const err = await a()
      .exportMarkdown({ htmlMarks: false })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain(sourceFile(entry, s().manifest!.editions));
    expect((err as Error).message).not.toContain("“”");
    expect(s().exportStage).toBeNull();
    expect(s().notice).not.toMatch(/Exported/);
  });
  it("names the first failing page by title", async () => {
    await a().saveCurrent(doc(p("x", [{ type: "underline" }])));
    const err = await a()
      .exportMarkdown({ htmlMarks: false })
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("Chapter One");
  });
  it("a write failure (disk full) rejects with the reason, sets no success notice and leaves the store usable", async () => {
    writeBytesError = new Error("No space left on device");
    await expect(a().exportMarkdown({ htmlMarks: false })).rejects.toThrow(/No space left/);
    expect(s().exportStage).toBeNull();
    expect(s().notice).not.toMatch(/Exported/);
    writeBytesError = null;
    await a().exportMarkdown({ htmlMarks: false });
    expect(s().notice).toMatch(/Exported exports\/en\/book\.md/);
  });
  it("a permission error that is a plain object (Rust ProjectError) is readable in the rejection", async () => {
    writeBytesError = { kind: "io", message: "Permission denied (os error 13)" } as never;
    const err = await a()
      .exportMarkdown({ htmlMarks: false })
      .catch((e: unknown) => e);
    expect(err).toBeTruthy();
    expect(s().exportStage).toBeNull();
  });
  it("an unreadable chapter file stops the export before anything is written", async () => {
    disk.set(sourceFile(s().manifest!.chapters[0]!, s().manifest!.editions), "{ corrupt");
    await expect(a().exportMarkdown({ htmlMarks: false })).rejects.toThrow(/not valid JSON/);
    expect(exported).toBeNull();
    expect(s().exportStage).toBeNull();
  });
  it("a missing chapter file stops the export with its name", async () => {
    const file = sourceFile(s().manifest!.chapters[0]!, s().manifest!.editions);
    disk.delete(file);
    await expect(a().exportMarkdown({ htmlMarks: false })).rejects.toThrow(file);
  });
  it("refuses a second export while one runs", async () => {
    const first = a().exportMarkdown({ htmlMarks: false });
    await expect(a().exportMarkdown({ htmlMarks: false })).rejects.toThrow(/already running/);
    await first;
  });
  it("refuses a book with no pages instead of writing an empty file", async () => {
    useProject.setState({ manifest: { ...s().manifest!, chapters: [] } });
    await expect(a().exportMarkdown({ htmlMarks: false })).rejects.toThrow(/no pages/);
    expect(exported).toBeNull();
    expect(s().notice).not.toMatch(/Exported/);
  });
  it("exports a large book", async () => {
    const words = "lorem ipsum dolor sit amet ".repeat(200);
    const chapters = Array.from({ length: 150 }, (_, i) => ({
      id: `big-${i}`,
      files: { en: `manuscript/${String(i + 2).padStart(3, "0")}-big.json` },
      titles: { en: `Big ${i}` },
    }));
    for (const c of chapters) disk.set(c.files.en, JSON.stringify(doc(p(words), p(words))));
    useProject.setState({
      manifest: { ...s().manifest!, chapters: [...s().manifest!.chapters, ...chapters] },
    });
    const t0 = Date.now();
    await a().exportMarkdown({ htmlMarks: false });
    expect(exported!.length).toBeGreaterThan(150 * 2 * 1000);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});

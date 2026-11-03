import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { disk } from "../../../test/fakeBridge";

const written = new Map<string, Uint8Array>();
const compiled: string[] = [];
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      written.set(p, b);
    },
    typstListFonts: async () => ["Libertinus Serif", "New Computer Modern"],
    typstQuery: async () => "",
    typstCompile: async (source: string) => {
      compiled.push(source);
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }],
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  disk.clear();
  written.clear();
  compiled.length = 0;
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
    history: { undo: [], redo: [] },
  });
  await a().createProject("/p", "Book", "Me");
  await a().saveCurrent(text("Once upon a time"));
});
afterEach(() => vi.useRealTimers());

/** Every export of the open book, as text: the bytes written for each format, and the Typst source for the PDF. */
async function everyExport(): Promise<Record<string, string>> {
  written.clear();
  compiled.length = 0;
  await a().exportEpub();
  await a().exportMarkdown({ htmlMarks: false });
  await a().exportDocx({ font: "times" });
  await a().exportRtf({ font: "times" });
  await a().exportPdf({ trimSize: "5.5x8.5", pdfA: false, template: "novel" });
  return {
    ...Object.fromEntries([...written].map(([p, b]) => [p, Buffer.from(b).toString("base64")])),
    pdfSource: compiled.join("\n"),
  };
}

describe("page icons", () => {
  it("are saved in the manifest and undone and redone with the book history", async () => {
    const id = s().manifest!.chapters[0]!.id;
    await a().setIcon(id, "moon");
    expect(s().manifest!.chapters[0]!.icon).toBe("moon");
    expect(JSON.parse(disk.get("cadabra.json") as string).chapters[0].icon).toBe("moon");
    expect(s().history.undo.at(-1)!.label).toBe("Change icon of Chapter One");
    await a().undo();
    expect(s().manifest!.chapters[0]!.icon).toBeUndefined();
    await a().redo();
    expect(s().manifest!.chapters[0]!.icon).toBe("moon");
    await a().setIcon(id, null);
    expect(s().manifest!.chapters[0]!.icon).toBeUndefined();
  });
  it("change nothing in the EPUB, Markdown, DOCX, RTF or PDF output", async () => {
    const before = await everyExport();
    expect(Object.keys(before).length).toBeGreaterThanOrEqual(5);
    await a().setIcon(s().manifest!.chapters[0]!.id, "skull");
    expect(await everyExport()).toEqual(before);
  });
});

describe("big first letter", () => {
  const chapterId = () => s().manifest!.chapters[0]!.id;
  it("a chapter's own choice is saved and undone with the book history", async () => {
    await a().setChapterDropCap(chapterId(), false);
    expect(s().manifest!.chapters[0]!.dropCap).toBe(false);
    expect(JSON.parse(disk.get("cadabra.json") as string).chapters[0].dropCap).toBe(false);
    expect(s().history.undo.at(-1)!.label).toBe("Change first letter of Chapter One");
    await a().undo();
    expect(s().manifest!.chapters[0]!.dropCap).toBeUndefined();
    await a().redo();
    await a().setChapterDropCap(chapterId(), null);
    expect("dropCap" in s().manifest!.chapters[0]!).toBe(false);
  });
  it("the book's choice is saved, cleared and a no-op when unchanged", async () => {
    await a().setBookDropCap(true);
    expect(s().manifest!.dropCap).toBe(true);
    const writes = disk.get("cadabra.json");
    await a().setBookDropCap(true);
    expect(disk.get("cadabra.json")).toBe(writes);
    await a().setBookDropCap(null);
    expect("dropCap" in s().manifest!).toBe(false);
  });
  it("reaches the PDF per chapter: the chapter beats the book, the book beats the template", async () => {
    const dropcaps = async () => {
      compiled.length = 0;
      await a().exportPdf({ trimSize: "5.5x8.5", pdfA: false, template: "poetry" });
      return compiled.join("\n").includes("#dropcap(");
    };
    expect(await dropcaps()).toBe(false); // poetry has none
    await a().setBookDropCap(true);
    expect(await dropcaps()).toBe(true);
    await a().setChapterDropCap(chapterId(), false);
    expect(await dropcaps()).toBe(false);
    await a().setChapterDropCap(chapterId(), true);
    await a().setBookDropCap(false);
    expect(await dropcaps()).toBe(true);
  });
  it("reaches the EPUB as a class on the chapter's body", async () => {
    const cls = async () => {
      await a().exportEpub();
      const zip = unzipSync(written.get("exports/en/book.epub")!);
      return /<body[^>]*class="([^"]*)"/.exec(strFromU8(zip[`OEBPS/${chapterId()}.xhtml`]!))![1];
    };
    await a().setBookDropCap(true);
    expect(await cls()).toBe("chapter dropcap");
    await a().setChapterDropCap(chapterId(), false);
    expect(await cls()).toBe("chapter");
    await a().setChapterDropCap(chapterId(), null);
    await a().setBookDropCap(false);
    expect(await cls()).toBe("chapter");
    await a().setBookDropCap(null); // the default template is the novel, which has one
    expect(await cls()).toBe("chapter dropcap");
  });
});

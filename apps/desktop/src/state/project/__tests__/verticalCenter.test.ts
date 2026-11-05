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
  await a().addMatter("front", "dedication");
});
afterEach(() => vi.useRealTimers());

const dedicationId = () => s().manifest!.frontMatter[0]!.id;

describe("vertical position of a matter page", () => {
  it("is saved in the manifest and undone and redone with the book history", async () => {
    await a().setVerticalCenter(dedicationId(), false);
    expect(s().manifest!.frontMatter[0]!.verticalCenter).toBe(false);
    expect(JSON.parse(disk.get("cadabra.json") as string).frontMatter[0].verticalCenter).toBe(
      false,
    );
    expect(s().history.undo.at(-1)!.label).toBe("Change vertical position of Dedication");
    await a().undo();
    expect(s().manifest!.frontMatter[0]!.verticalCenter).toBeUndefined();
    await a().redo();
    expect(s().manifest!.frontMatter[0]!.verticalCenter).toBe(false);
    await a().setVerticalCenter(dedicationId(), null);
    expect("verticalCenter" in s().manifest!.frontMatter[0]!).toBe(false);
  });

  it("is carried by the page the previews and exports read", async () => {
    await a().setVerticalCenter(dedicationId(), true);
    const pages = await a().readPages();
    expect(pages.find((p) => p.id === dedicationId())).toMatchObject({
      section: "front",
      kind: "dedication",
      verticalCenter: true,
    });
    expect(pages.find((p) => p.section === "chapter")).not.toHaveProperty("verticalCenter");
  });

  it("reaches the PDF: a dedication set to top is laid out at the top", async () => {
    const source = async () => {
      compiled.length = 0;
      await a().exportPdf({ trimSize: "5.5x8.5", pdfA: false, template: "novel" });
      return compiled.join("\n");
    };
    expect(await source()).not.toContain("centre: false");
    await a().setVerticalCenter(dedicationId(), false);
    expect(await source()).toContain('"dedication", centre: false');
  });

  it("reaches the EPUB: the template's kinds and the page's own choice become the class vcenter", async () => {
    const cls = async () => {
      await a().exportEpub();
      const zip = unzipSync(written.get("exports/en/book.epub")!);
      return /<body[^>]*class="([^"]*)"/.exec(strFromU8(zip[`OEBPS/${dedicationId()}.xhtml`]!))![1];
    };
    expect(await cls()).toBe("dedication vcenter"); // the novel template centres it
    await a().setVerticalCenter(dedicationId(), false);
    expect(await cls()).toBe("dedication");
    await a().setVerticalCenter(dedicationId(), true);
    expect(await cls()).toBe("dedication vcenter");
  });
});

describe("page start and blank pages", () => {
  it("saves where a matter page starts, and undoes it", async () => {
    await a().setStartOnNext(dedicationId(), true);
    expect(s().manifest!.frontMatter[0]!.startOnNext).toBe(true);
    expect(await a().undo()).toBe(true);
    expect(s().manifest!.frontMatter[0]!.startOnNext).toBeUndefined();
  });

  it("adds a blank page after the open page, then at the end of the chapters with no page open", async () => {
    const count = () => {
      const m = s().manifest!;
      return m.frontMatter.length + m.chapters.length + m.backMatter.length;
    };
    const before = count();
    await a().addBlank();
    expect(count()).toBe(before + 1);
    useProject.setState({ currentId: null });
    await a().addBlank();
    expect(count()).toBe(before + 2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

const sw = {
  epubFails: null as null | (() => never),
  markdownFails: null as null | (() => never),
  holdWrite: null as null | Promise<void>,
};
vi.mock("@cadabracraft/export-epub", async (orig) => {
  const actual = await orig<typeof import("@cadabracraft/export-epub")>();
  return {
    ...actual,
    buildEpub: (...args: Parameters<typeof actual.buildEpub>) => {
      sw.epubFails?.();
      return actual.buildEpub(...args);
    },
  };
});
vi.mock("@cadabracraft/export-markdown", async (orig) => {
  const actual = await orig<typeof import("@cadabracraft/export-markdown")>();
  return {
    ...actual,
    bookToMarkdown: (...args: Parameters<typeof actual.bookToMarkdown>) => {
      sw.markdownFails?.();
      return actual.bookToMarkdown(...args);
    },
  };
});
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      await sw.holdWrite;
      disk.set(p, `bytes:${b.length}`);
    },
  }),
);

import { EpubExportError } from "@cadabracraft/export-epub";
import { MarkdownExportError } from "@cadabracraft/export-markdown";
import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();

beforeEach(async () => {
  disk.clear();
  sw.epubFails = null;
  sw.markdownFails = null;
  sw.holdWrite = null;
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    activeLanguage: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    exportStage: null,
  });
  await a().createProject("/p", "Book", "Me");
});

const untitled = () => {
  const m = s().manifest!;
  useProject.setState({
    manifest: { ...m, chapters: [{ ...m.chapters[0]!, titles: { en: "" } }] },
  });
};

describe("EPUB export, rare paths", () => {
  it("refuses a second export while one runs", async () => {
    let release = () => {};
    sw.holdWrite = new Promise<void>((r) => (release = r));
    const first = a().exportEpub();
    await expect(a().exportEpub()).rejects.toThrow(/already running/);
    release();
    await first;
  });
  it("uses the default stylesheet when the book names a template that does not exist", async () => {
    useProject.setState({ manifest: { ...s().manifest!, template: "no-such-template" } });
    await a().exportEpub();
    expect(s().notice).toBe("Exported exports/en/book.epub");
  });
  it("names an untitled page by its file in an exporter refusal", async () => {
    untitled();
    sw.epubFails = () => {
      throw new EpubExportError("unsupported-node", "x", {
        chapter: { id: "ch-1", title: "" },
        nodeType: "bogus",
        path: "p",
      });
    };
    await expect(a().exportEpub()).rejects.toThrow(/manuscript\/001-chapter-one\.json/);
  });
  it("copes with the book being closed while the exporter refuses", async () => {
    sw.epubFails = () => {
      useProject.setState({ manifest: null });
      throw new EpubExportError("unsupported-node", "x", {
        chapter: { id: "ch-1", title: "" },
        nodeType: "bogus",
        path: "p",
      });
    };
    await expect(a().exportEpub()).rejects.toThrow(/“ch-1” has a “bogus”/);
  });
});

describe("Markdown export, rare paths", () => {
  it("passes an unexpected error through unchanged", async () => {
    sw.markdownFails = () => {
      throw new TypeError("bug");
    };
    await expect(a().exportMarkdown({ htmlMarks: false })).rejects.toThrow(TypeError);
  });
  it("keeps the library's message when no single page can be blamed", async () => {
    sw.markdownFails = () => {
      throw new MarkdownExportError("whole book problem");
    };
    await expect(a().exportMarkdown({ htmlMarks: false })).rejects.toThrow("whole book problem");
  });
});

describe("PDF export, rare paths", () => {
  it("refuses a second export while one runs", async () => {
    useProject.setState({ exportStage: "rendering" });
    await expect(
      a().exportPdf({ trimSize: "5.5x8.5", pdfA: false, template: "x" }),
    ).rejects.toThrow(/already running/);
  });
});

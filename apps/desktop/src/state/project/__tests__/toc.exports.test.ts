import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

// The contents list reaches every exporter, the print preview and the page measure through lib/tocExport.
const written = new Map<string, Uint8Array>();
const typst = { sources: [] as string[] };
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      written.set(p, b);
    },
    typstListFonts: async () => ["Libertinus Serif", "New Computer Modern"],
    typstQuery: async (source: string) => {
      typst.sources.push(source);
      return '{"total":0,"starts":[]}';
    },
    typstCompile: async (source: string) => {
      typst.sources.push(source);
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (path: string) => new TextDecoder().decode(written.get(path)!);
const heading = (level: number, t: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text: t }],
});

beforeEach(async () => {
  disk.clear();
  written.clear();
  typst.sources = [];
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
  await a().createProject("/p", "Book", "Me");
  const file = s().manifest!.chapters[0]!.files.en!;
  disk.set(
    file,
    JSON.stringify({ type: "doc", content: [heading(1, "Opening"), heading(2, "Sub")] }),
  );
  await a().addMatter("front", "contents");
  const id = s().manifest!.frontMatter[0]!.id;
  await a().setTocDepth(id, 2);
  await a().renameTocItem(id, s().manifest!.chapters[0]!.id, "The Opening");
});

describe("a book with a contents page", () => {
  it("writes the list into the EPUB's contents page and navigation", async () => {
    await a().exportEpub({});
    const files = unzipSync(written.get("exports/en/book.epub")!);
    const id = s().manifest!.frontMatter[0]!.id;
    expect(strFromU8(files[`OEBPS/${id}.xhtml`]!)).toContain("The Opening");
    expect(strFromU8(files["OEBPS/nav.xhtml"]!)).toContain("Sub");
  });
  it("writes it into the Rich Text and Word manuscripts", async () => {
    await a().exportRtf({ font: "times" });
    expect(text("exports/en/manuscript.rtf")).toContain("The Opening");
    await a().exportDocx({ font: "times" });
    expect(written.has("exports/en/manuscript.docx")).toBe(true);
  });
  it("writes it into the Markdown as links", async () => {
    await a().exportMarkdown({ htmlMarks: false });
    expect(text("exports/en/book.md")).toContain("[The Opening](#");
  });
  it("typesets it in the PDF, the print preview and the page measure", async () => {
    await a().exportPdf({ trimSize: "5.5x8.5", pdfA: false, template: "novel" });
    expect(typst.sources.at(-1)).toContain('title: "The Opening"');
    typst.sources = [];
    await a().renderPreview({});
    expect(typst.sources.at(-1)).toContain('title: "Sub"');
    typst.sources = [];
    await a().measurePages({ marks: true });
    expect(typst.sources.at(-1)).toContain("toc-list(");
    typst.sources = [];
    await a().measureChapter(s().manifest!.chapters[0]!.id); // one page alone: no list
    expect(typst.sources.at(-1)).not.toContain("toc-list(");
  });
});

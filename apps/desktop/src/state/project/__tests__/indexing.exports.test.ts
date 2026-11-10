import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { disk } from "../../../test/fakeBridge";

const written = new Map<string, Uint8Array>();
const typst = { compiles: [] as { source: string }[], queries: [] as string[] };
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeBytes: async (_r: string, p: string, b: Uint8Array) => {
      written.set(p, b);
    },
    typstListFonts: async () => ["Libertinus Serif", "New Computer Modern"],
    typstQuery: async (source: string) => {
      typst.queries.push(source);
      return JSON.stringify({ total: 1, starts: [] });
    },
    typstCompile: async (source: string) => {
      typst.compiles.push({ source });
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string, marks: unknown[] = []) => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks } : {}),
});
const doc = (...c: unknown[]) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: c }] as never,
});
const str = (path: string) => strFromU8(written.get(path)!);

beforeEach(async () => {
  disk.clear();
  written.clear();
  typst.compiles = [];
  typst.queries = [];
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
  await a().createProject("/p", "Book", "Ada");
  await a().saveCurrent(
    doc(
      text("The "),
      text("magic", [{ type: "indexEntry", attrs: { id: "ix-1", term: "Magic" } }]),
      text(" of an "),
      text("orb", [{ type: "glossaryTerm", attrs: { id: "gl-1" } }]),
    ),
  );
  await a().selectChapter(s().currentId!);
});

const turnOn = async () => {
  await a().setIndexSettings({ enabled: true });
  await a().addGlossaryEntry({ term: "Orb", definition: "A glass sphere." });
  const id = s().manifest!.glossary!.entries[0]!.id;
  await a().saveCurrent(
    doc(
      text("The "),
      text("magic", [{ type: "indexEntry", attrs: { id: "ix-1", term: "Magic" } }]),
      text(" of an "),
      text("orb", [{ type: "glossaryTerm", attrs: { id } }]),
    ),
  );
  await a().setGlossarySettings({ enabled: true, inIndex: true });
};

describe("exports with an index and a glossary", () => {
  it("writes neither page when the author switched neither on", async () => {
    await a().exportMarkdown({ htmlMarks: false });
    expect(str("exports/en/book.md")).not.toMatch(/Index|Glossary/);
  });

  it("writes them into the Markdown, Word and Rich Text manuscripts", async () => {
    await turnOn();
    await a().exportMarkdown({ htmlMarks: false });
    const md = str("exports/en/book.md");
    expect(md).toContain("Index");
    expect(md).toContain("Magic");
    expect(md).toContain("Glossary");
    expect(md).toContain("A glass sphere.");
    await a().exportDocx({ font: "serif" } as never);
    const docx = strFromU8(
      unzipSync(written.get("exports/en/manuscript.docx")!)["word/document.xml"]!,
    );
    expect(docx).toContain("Magic");
    expect(docx).toContain("A glass sphere.");
    await a().exportRtf({ font: "serif" } as never);
    expect(str("exports/en/manuscript.rtf")).toContain("A glass sphere.");
  });

  it("writes them into the EPUB, with the glossary term listed in the index as a place of its own", async () => {
    await turnOn();
    await a().exportEpub({});
    const files = unzipSync(written.get("exports/en/book.epub")!);
    const names = Object.keys(files);
    const index = names.find((n) => n.endsWith("generated-index.xhtml"));
    const glossary = names.find((n) => n.endsWith("generated-glossary.xhtml"));
    expect(index && glossary).toBeTruthy();
    const body = strFromU8(files[index!]!);
    expect(body).toContain("Magic");
    expect(body).toContain("Orb");
    expect(strFromU8(files[glossary!]!)).toContain("A glass sphere.");
  });

  it("typesets them into the print PDF and into the page measure", async () => {
    await turnOn();
    await a().exportPdf({ trimSize: "5.5x8.5", pdfA: false, template: "nonfiction" });
    const source = typst.compiles.at(-1)!.source;
    expect(source).toContain("Magic");
    expect(source).toContain("A glass sphere.");
    const measured = typst.queries.length;
    await a().measurePages();
    expect(typst.queries.slice(measured).join("\n")).toContain("A glass sphere.");
  });
});

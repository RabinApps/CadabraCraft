import { sourceTitle } from "@cadabracraft/format";
import { chapterDocProblem } from "@cadabracraft/editor-schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../test/fakeBridge";

const sources = new Map<string, Uint8Array>();
const enc = (s: string) => new TextEncoder().encode(s);
vi.mock("../bridge", async () =>
  (await import("../../test/fakeBridge")).fakeBridge({
    readImportSource: async (p: string) => {
      const b = sources.get(p);
      if (!b) throw new Error(`cannot read ${p}`);
      return b;
    },
  }),
);

import { useProject } from "../../state/project/index";
import {
  loadImport,
  outlineFormatFor,
  parseImport,
  parseOutlineSource,
  runImport,
  sceneCountOf,
} from "../importBook";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const titles = () => s().manifest!.chapters.map((c) => sourceTitle(c, s().manifest!.editions));

const OPML =
  '<?xml version="1.0"?><opml version="2.0" xmlns:cc="urn:cadabracraft:outline"><body>' +
  '<outline text="Arrival"><outline text="The storm" _note="Ana runs." cc:pov="Ana" cc:status="draft" cc:target="1500" cc:date="2024-05-01" cc:cast="a"/>' +
  '<outline text="Harbour" cc:status="weird"/></outline><outline text=""/></body></opml>';

beforeEach(async () => {
  sources.clear();
  disk.clear();
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    importReport: null,
  });
  await a().createProject("/book", "Mine", "Me");
});

describe("reading an outline", () => {
  it("takes .opml and .csv as outlines always and Markdown only when asked", async () => {
    sources.set("/x/o.md", enc("# A"));
    const md = await loadImport("/x/o.md");
    expect(outlineFormatFor(md, false)).toBeNull();
    expect(outlineFormatFor(md, true)).toBe("markdown");
    sources.set("/x/o.opml", enc(OPML));
    sources.set("/x/o.csv", enc("chapter,title\nA,B"));
    expect(outlineFormatFor(await loadImport("/x/o.opml"), false)).toBe("opml");
    expect(outlineFormatFor(await loadImport("/x/o.csv"), false)).toBe("csv");
    expect(outlineFormatFor({ ext: "docx", bytes: new Uint8Array() }, true)).toBeNull();
  });

  it("makes valid chapters with scenes (new ids, notes) and warnings with codes", async () => {
    sources.set("/x/o.opml", enc(OPML));
    const r = await parseImport(await loadImport("/x/o.opml"));
    expect(r.assets).toEqual([]);
    expect(r.chapters.map((c) => [c.title, sceneCountOf(c.doc)])).toEqual([
      ["Arrival", 2],
      ["Untitled", 0],
    ]);
    for (const c of r.chapters) expect(chapterDocProblem(c.doc)).toBeNull();
    expect(r.chapters[0]!.doc.content[1]).toMatchObject({
      type: "scene",
      attrs: {
        title: "The storm",
        synopsis: "Ana runs.",
        pov: "Ana",
        status: "draft",
        target: 1500,
      },
    });
    expect(r.warnings.map((w) => [w.code, w.severity]).sort()).toEqual([
      ["outline-bad-status", "warning"],
      ["outline-cast-skipped", "warning"],
    ]);
  });

  it("reads a Markdown file as an outline when asked and as a manuscript otherwise", async () => {
    sources.set("/x/o.md", enc("# One\n\n## Scene\n\nIt happens.\n"));
    const src = await loadImport("/x/o.md");
    expect((await parseImport(src, 1, true)).chapters[0]!.doc.content[1]).toMatchObject({
      type: "scene",
      attrs: { title: "Scene", synopsis: "It happens." },
    });
    expect((await parseImport(src, 1, false)).chapters[0]!.doc.content[0]).toMatchObject({
      type: "heading",
    });
  });

  it("gives a sentence for a file that cannot be read, and passes other failures on", () => {
    const opml = (text: string) => parseOutlineSource({ ext: "opml", bytes: enc(text) }, "opml");
    expect(() => opml("<opml><body>")).toThrow(/damaged|not written correctly/);
    expect(() => opml("<html/>")).toThrow(/not an OPML/);
    expect(() => opml("<opml><body/></opml>")).toThrow(/no chapters or scenes/);
    expect(() => opml('<!DOCTYPE x [<!ENTITY a "b">]><opml/>')).toThrow(/damaged/);
    expect(() => parseOutlineSource({ ext: "csv", bytes: enc("a,b\n1,2") }, "csv")).toThrow(
      /no column named/,
    );
    expect(() =>
      parseOutlineSource({ ext: "opml", bytes: new Uint8Array([0x3c, 0, 0, 0]) }, "opml"),
    ).toThrow(/does not look like text/);
  });
});

describe("importing an outline", () => {
  it("adds its chapters after the existing ones with new scene ids, and again without clashes", async () => {
    sources.set("/x/o.opml", enc(OPML));
    const before = disk.get("manuscript/001-chapter-one.json");
    await a().importIntoBook("/x/o.opml", { outline: true });
    expect(titles()).toEqual(["Chapter One", "Arrival", "Untitled"]);
    expect(disk.get("manuscript/001-chapter-one.json")).toBe(before);
    expect(s().importReport).toMatchObject({ chapterCount: 2, imageCount: 0 });
    const first = JSON.parse(disk.get("manuscript/002-arrival.json")!);
    expect(first.content[1].attrs.id).toMatch(/^sc-[0-9a-f]{8}$/);
    await a().importIntoBook("/x/o.opml");
    const second = JSON.parse(disk.get("manuscript/004-arrival.json")!);
    expect(second.content[1].attrs.id).not.toBe(first.content[1].attrs.id);
    expect(titles()).toHaveLength(5);
  });

  it("changes nothing when the outline is refused", async () => {
    sources.set("/x/bad.opml", enc("<opml><body>"));
    const before = new Map(disk);
    await expect(a().importIntoBook("/x/bad.opml")).rejects.toThrow(/damaged/);
    expect(new Map(disk)).toEqual(before);
    expect(titles()).toEqual(["Chapter One"]);
  });

  it("creates a new book from an outline", async () => {
    sources.set("/x/o.csv", enc("chapter,title,summary\nOne,A,x\nTwo,B,y\n"));
    const report = await runImport({
      sourcePath: "/x/o.csv",
      root: "/new",
      title: "From outline",
      author: "Me",
    });
    expect(report.chapterCount).toBe(2);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(2);
  });
});

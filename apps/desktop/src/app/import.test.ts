import { beforeEach, describe, expect, it, vi } from "vitest";
import { PNG_BYTES, TINY_MD, tinyDocx } from "../../e2e/fixtures";

// Fake bridge: a source "file system" the importer may read, and the project disk it writes to.
const sources = new Map<string, Uint8Array>();
const images = new Map<string, Uint8Array>(); // "<sourceFile>|<ref>"
const disk = new Map<string, string>();
const assets = new Map<string, Uint8Array>();
let failWrite: string | null = null;
let readImportCalls = 0;
const enc = (s: string) => new TextEncoder().encode(s);
const h = (s: string) => `h:${s.length}:${s.slice(0, 40)}`;
vi.mock("../lib/bridge", () => ({
  bridge: {
    readImportSource: async (p: string) => { readImportCalls++; const b = sources.get(p); if (!b) throw new Error(`cannot read ${p}`); return b; },
    readImportImage: async (src: string, ref: string) => { const b = images.get(`${src}|${ref}`); if (!b) throw new Error(`image not found: ${ref}`); return b; },
    importAssetBytes: async (_r: string, name: string, bytes: Uint8Array) => { assets.set(`assets/${name}`, bytes); return `assets/${name}`; },
    createProject: async (_r: string, m: string) => { disk.set("cadabra.json", m); },
    readFile: async (_r: string, p: string) => (disk.has(p) ? { contents: disk.get(p)!, hash: h(disk.get(p)!) } : null),
    writeFile: async (_r: string, p: string, c: string) => {
      if (failWrite && p.includes(failWrite)) throw new Error("disk full");
      disk.set(p, c);
      return { hash: h(c), conflict_copy: null };
    },
    backupManifest: async () => "backup",
    watchProject: async () => {},
  },
}));

import { useProject } from "./store";
import { applyChapterEdits, groupWarnings, parseImport } from "./importBook";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();

beforeEach(() => {
  sources.clear(); images.clear(); disk.clear(); assets.clear();
  failWrite = null; readImportCalls = 0;
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0, importReport: null });
});

describe("importBook", () => {
  it("imports Markdown into a new project, one file per chapter, and reports warnings", async () => {
    sources.set("/src/My_Book.md", enc(TINY_MD));
    images.set("/src/My_Book.md|img/pixel.png", PNG_BYTES);
    await a().importBook("/src/My_Book.md", "/new", "My Book", "Me");
    expect(s().manifest!.chapters.map((c) => c.title)).toEqual(["Alpha", "Beta"]);
    expect(s().manifest!.chapters.map((c) => c.file)).toEqual(["manuscript/001-alpha.json", "manuscript/002-beta.json"]);
    expect(JSON.parse(disk.get("cadabra.json")!)).toMatchObject({ title: "My Book", author: "Me" });
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(2);
    expect(s().currentId).toBe("ch-1");
    expect(assets.has("assets/pixel.png")).toBe(true);
    expect(disk.get("manuscript/001-alpha.json")).toContain('"src": "assets/pixel.png"');
    const r = s().importReport!;
    expect(r).toMatchObject({ chapterCount: 2, imageCount: 1, fileName: "My_Book.md" });
    expect(r.warnings.map((w) => w.code)).toContain("table");
    expect(groupWarnings(r.warnings).find((g) => g.code === "table")!.count).toBeGreaterThanOrEqual(1);
  });

  it("imports a DOCX, storing embedded image bytes under assets/", async () => {
    sources.set("/src/book.docx", tinyDocx({ image: true }));
    await a().importBook("/src/book.docx", "/new", "Book", "Me");
    expect(s().manifest!.chapters.map((c) => c.title)).toEqual(["Dawn", "Dusk"]);
    expect([...assets.keys()]).toHaveLength(1);
    const [path, bytes] = [...assets.entries()][0]!;
    expect(bytes).toEqual(PNG_BYTES);
    expect(disk.get("manuscript/002-dusk.json")).toContain(`"src": "${path}"`);
    expect(s().importReport!.imageCount).toBe(1);
  });

  it("turns a missing Markdown image into a warning and keeps its alt text instead of a dead image", async () => {
    sources.set("/src/b.md", enc(TINY_MD)); // no image registered
    await a().importBook("/src/b.md", "/new", "B", "Me");
    const r = s().importReport!;
    expect(r.imageCount).toBe(0);
    const w = r.warnings.find((x) => x.code === "image-not-imported")!;
    expect(w.message).toContain("img/pixel.png");
    const ch = disk.get("manuscript/001-alpha.json")!;
    expect(ch).not.toContain('"image"');
    expect(ch).toContain("[Image: A pixel]");
  });

  it("tries the percent-decoded reference when the raw one is not found", async () => {
    sources.set("/src/b.md", enc("# T\n\n![x](my%20pic.png)\n"));
    images.set("/src/b.md|my pic.png", PNG_BYTES);
    await a().importBook("/src/b.md", "/new", "B", "Me");
    expect(s().importReport!.imageCount).toBe(1);
  });

  it("creates nothing when the importer rejects the file (ImportError)", async () => {
    sources.set("/src/bad.docx", enc("this is not a zip"));
    await expect(a().importBook("/src/bad.docx", "/new", "Bad", "Me")).rejects.toThrow(/not look like a valid \.docx/);
    expect(disk.size).toBe(0);
    expect(s().manifest).toBeNull();
    expect(s().importReport).toBeNull();
  });

  it("creates nothing when there is no text to import, or the source cannot be read, or the type is wrong", async () => {
    sources.set("/src/empty.md", enc("   \n"));
    await expect(a().importBook("/src/empty.md", "/new", "E", "Me")).rejects.toThrow(/no text to import/);
    await expect(a().importBook("/src/missing.md", "/new", "E", "Me")).rejects.toThrow(/cannot read/);
    await expect(a().importBook("/src/x.pdf", "/new", "E", "Me")).rejects.toThrow(/\.docx, \.md/);
    expect(disk.size).toBe(0);
  });

  it("says what was written when a later write fails, and never lists unwritten chapters", async () => {
    sources.set("/src/b.md", enc("# One\n\na\n\n# Two\n\nb\n"));
    failWrite = "002-two";
    await expect(a().importBook("/src/b.md", "/new", "B", "Me")).rejects.toThrow(/disk full.*Already written to \/new: 1 chapter files and 0 images/);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toEqual([]);
    expect(s().importReport).toBeNull();
  });

  it("never writes to the source (only reads it)", async () => {
    const bytes = enc(TINY_MD);
    const copy = bytes.slice();
    sources.set("/src/b.md", bytes);
    await a().importBook("/src/b.md", "/new", "B", "Me");
    expect(sources.get("/src/b.md")).toEqual(copy);
    expect(readImportCalls).toBe(1);
  });

  it("dismisses the report", async () => {
    sources.set("/src/b.md", enc("# T\n\nx\n"));
    await a().importBook("/src/b.md", "/new", "B", "Me");
    a().dismissImportReport();
    expect(s().importReport).toBeNull();
  });
});

describe("wizard preview", () => {
  const md = (text: string) => ({ ext: "md", bytes: enc(text) });
  const text = "# One\n\nA\n\n## Sub\n\nB\n\n# Two\n\nC\n";

  it("re-splits at another heading level", () => {
    expect(parseImport(md(text), 1).chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(parseImport(md(text), 2).chapters.map((c) => c.title)).toContain("Sub");
  });

  it("drops skipped chapters, renames, and refuses an empty selection", () => {
    const r = parseImport(md(text), 1);
    const out = applyChapterEdits(r, [{ title: " Renamed ", include: true }, { title: "Two", include: false }]);
    expect(out.chapters.map((c) => c.title)).toEqual(["Renamed"]);
    expect(() => applyChapterEdits(r, r.chapters.map((c) => ({ title: c.title, include: false })))).toThrow();
    expect(applyChapterEdits(r, [{ title: "  ", include: true }, { title: "Two", include: true }]).chapters[0]!.title).toBe("One");
  });

  it("keeps only images used by kept chapters", () => {
    const r = parseImport(md("# One\n\n![a](img/pixel.png)\n\n# Two\n\nC\n"), 1);
    expect(r.assets).toHaveLength(1);
    expect(applyChapterEdits(r, [{ title: "One", include: false }, { title: "Two", include: true }]).assets).toHaveLength(0);
  });
});

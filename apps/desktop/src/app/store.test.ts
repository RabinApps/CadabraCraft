import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

// In-memory stand-in for the Rust project layer, including its conflict-copy rule.
const disk = new Map<string, string>();
const assets = new Map<string, Uint8Array>();
const written: Record<string, Uint8Array> = {};
let picked: string | null = "/pics/cover.png";
let importError: string | null = null;
const h = (s: string) => `h:${s.length}:${s.slice(0, 40)}`;
vi.mock("../lib/bridge", () => ({
  bridge: {
    createProject: async (_r: string, m: string) => { disk.set("cadabra.json", m); },
    readFile: async (_r: string, p: string) => (disk.has(p) ? { contents: disk.get(p)!, hash: h(disk.get(p)!) } : null),
    writeFile: async (_r: string, p: string, c: string, base: string | null) => {
      let conflict_copy: string | null = null;
      if (base && disk.has(p) && h(disk.get(p)!) !== base) { conflict_copy = p.replace(".json", ".conflict-x.json"); disk.set(conflict_copy, disk.get(p)!); }
      disk.set(p, c);
      return { hash: h(c), conflict_copy };
    },
    writeBytes: async (_r: string, p: string, b: Uint8Array) => { disk.set(p, `bytes:${b.length}`); written[p] = b; },
    backupManifest: async () => "backup",
    pickImage: async () => picked,
    importAsset: async (_r: string, src: string) => {
      if (importError) throw new Error(importError);
      const rel = `assets/${src.split("/").pop()}`;
      assets.set(rel, new Uint8Array([1, 2, 3]));
      return rel;
    },
    readAsset: async (_r: string, p: string) => { const b = assets.get(p); if (!b) throw new Error("missing"); return b; },
    watchProject: async () => {},
    trashFile: async (_r: string, p: string) => { const c = disk.get(p)!; const to = `.cadabra/trash/20260101-1200-${p.replaceAll("/", "__")}`; disk.delete(p); disk.set(to, c); return to; },
    listTrash: async () => [...disk.keys()].filter((k) => k.startsWith(".cadabra/trash/")).map((k) => ({ path: k, original: k.slice(29).replaceAll("__", "/"), trashed_at: "20260101-1200" })),
    restoreTrash: async (_r: string, p: string) => {
      const orig = p.slice(29).replaceAll("__", "/");
      let to = orig;
      for (let n = 2; disk.has(to); n++) to = orig.replace(/\.json$/, `-${n}.json`);
      disk.set(to, disk.get(p)!); disk.delete(p); return to;
    },
  },
}));

import { useProject } from "./store";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const text = (t: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] }] });

beforeEach(async () => {
  disk.clear();
  assets.clear();
  picked = "/pics/cover.png";
  importError = null;
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0 });
  await a().createProject("/p", "Book", "Me");
});

describe("project store", () => {
  it("creates a project with a first chapter on disk", () => {
    expect(s().manifest!.chapters.map((c) => c.title)).toEqual(["Chapter One"]);
    expect(disk.has("manuscript/001-chapter-one.json")).toBe(true);
  });
  it("flushes unsaved edits when switching chapters", async () => {
    await a().add("Two");
    await a().selectChapter("ch-1");
    a().setDraft(text("typed but not saved"));
    await a().selectChapter("ch-2");
    expect(disk.get("manuscript/001-chapter-one.json")).toContain("typed but not saved");
  });
  it("reorders chapters in the manifest only", async () => {
    await a().add("Two");
    await a().move("ch-2", -1);
    expect(s().manifest!.chapters.map((c) => c.id)).toEqual(["ch-2", "ch-1"]);
    expect(JSON.parse(disk.get("cadabra.json")!).chapters[0].id).toBe("ch-2");
  });
  it("delete moves the file to the trash instead of removing it", async () => {
    await a().add("Two");
    a().setDraft(text("precious"));
    await a().saveCurrent(s().draft!);
    await a().remove("ch-2");
    expect(s().manifest!.chapters.map((c) => c.id)).toEqual(["ch-1"]);
    expect([...disk.keys()].some((k) => k.startsWith(".cadabra/trash/") && disk.get(k)!.includes("precious"))).toBe(true);
  });
  it("restores a trashed chapter to the end, never overwriting a chapter that took its file name", async () => {
    await a().add("Two");
    a().setDraft({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Two" }] }, ...text("precious").content] });
    await a().flush();
    await a().remove("ch-2");
    await a().add("Two"); // reuses manuscript/002-two.json
    await a().refreshTrash();
    expect(s().trash.map((x) => x.title)).toEqual(["Two"]);
    await a().restoreTrash(s().trash[0]!.path);
    const chapters = s().manifest!.chapters;
    expect(chapters.map((c) => c.title)).toEqual(["Chapter One", "Two", "Two"]);
    expect(new Set(chapters.map((c) => c.file)).size).toBe(3);
    expect(disk.get(chapters[2]!.file)).toContain("precious");
    expect(JSON.parse(disk.get("cadabra.json")!).chapters).toHaveLength(3);
    expect(s().trash).toEqual([]);
    expect(s().currentId).toBe(chapters[2]!.id);
  });
  it("restores a trashed matter page into its own section", async () => {
    await a().addMatter("back", "colophon");
    await a().remove("bm-1");
    await a().refreshTrash();
    await a().restoreTrash(s().trash[0]!.path);
    expect(s().manifest!.backMatter.map((e) => e.file)).toEqual(["back-matter/01-colophon.json"]);
    expect(s().manifest!.chapters).toHaveLength(1);
  });
  it("keeps both versions when a chapter changed outside the app", async () => {
    disk.set("manuscript/001-chapter-one.json", "edited by sync");
    await a().saveCurrent(text("mine"));
    expect(s().notice).toMatch(/kept as/);
    expect([...disk.values()]).toContain("edited by sync");
    expect(disk.get("manuscript/001-chapter-one.json")).toContain("mine");
  });
  it("exports every chapter into exports/", async () => {
    await a().add("Two");
    await a().exportEpub();
    expect(disk.get("exports/book.epub")).toMatch(/^bytes:/);
  });
  it("imports a picked image and returns its relative asset path", async () => {
    expect(await a().importImage()).toBe("assets/cover.png");
    expect(assets.has("assets/cover.png")).toBe(true);
  });
  it("returns null when the picker is cancelled", async () => {
    picked = null;
    expect(await a().importImage()).toBeNull();
    expect(s().notice).not.toMatch(/image/);
  });
  it("reports a refused image through the notice instead of throwing", async () => {
    importError = "cover.png is larger than 25 MB";
    expect(await a().importImage()).toBeNull();
    expect(s().notice).toMatch(/Could not add the image: cover\.png is larger/);
  });
  it("exports images that chapters reference and fails clearly when one is missing", async () => {
    const withImage = { type: "doc" as const, content: [{ type: "image" as const, attrs: { src: "assets/cover.png", alt: "Cover", title: null } }] };
    await a().saveCurrent(withImage);
    await expect(a().exportEpub()).rejects.toThrow(/Missing image file assets\/cover\.png/);
    assets.set("assets/cover.png", new Uint8Array([1, 2, 3]));
    await a().exportEpub();
    expect(disk.get("exports/book.epub")).toMatch(/^bytes:/);
  });
  it("puts the cover in the EPUB and refuses to export when its file is missing", async () => {
    await a().updateDetails({ ...s().manifest!, isbn: "", cover: "assets/front.png" });
    await expect(a().exportEpub()).rejects.toThrow(/cover image assets\/front\.png could not be read/);
    expect(disk.has("exports/book.epub")).toBe(false);
    assets.set("assets/front.png", new Uint8Array([1, 2, 3]));
    await a().exportEpub();
    const files = unzipSync(written["exports/book.epub"]!);
    expect(files["OEBPS/assets/front.png"]).toBeDefined();
    expect(strFromU8(files["OEBPS/content.opf"]!)).toContain('properties="cover-image"');
    expect(strFromU8(files["OEBPS/content.opf"]!)).toMatch(/<spine><itemref idref="epub-cover"\/><itemref idref="ch-1"\/>/);
  });
  it("reopens a project from disk", async () => {
    const json = disk.get("cadabra.json")!;
    useProject.setState({ manifest: null, currentId: null });
    await a().openProject("/p");
    expect(JSON.stringify(s().manifest, null, 2) + "\n").toBe(json);
    expect(s().currentId).toBe("ch-1");
  });
  it("refuses a folder without a manifest", async () => {
    disk.delete("cadabra.json");
    await expect(a().openProject("/p")).rejects.toThrow(/No cadabra.json/);
  });

  describe("external changes", () => {
    it("reloads the current chapter when there are no unsaved edits", async () => {
      disk.set("manuscript/001-chapter-one.json", JSON.stringify(text("from sync")));
      await a().externalChange("manuscript/001-chapter-one.json");
      expect(JSON.stringify(s().currentDoc)).toContain("from sync");
      expect(s().reloadCount).toBe(1);
    });
    it("does not clobber unsaved edits and warns instead", async () => {
      a().setDraft(text("mine"));
      disk.set("manuscript/001-chapter-one.json", JSON.stringify(text("from sync")));
      await a().externalChange("manuscript/001-chapter-one.json");
      expect(s().draft).toEqual(text("mine"));
      expect(s().reloadCount).toBe(0);
      expect(s().notice).toMatch(/keep both versions/);
    });
    it("ignores the echo of our own writes", async () => {
      await a().saveCurrent(text("ours"));
      await a().externalChange("manuscript/001-chapter-one.json");
      expect(s().reloadCount).toBe(0);
    });
    it("picks up a manifest changed outside, and survives a corrupt one", async () => {
      const m = JSON.parse(disk.get("cadabra.json")!);
      m.chapters[0].title = "Renamed elsewhere";
      disk.set("cadabra.json", JSON.stringify(m));
      await a().externalChange("cadabra.json");
      expect(s().manifest!.chapters[0]!.title).toBe("Renamed elsewhere");
      disk.set("cadabra.json", "{broken");
      await a().externalChange("cadabra.json");
      expect(s().manifest!.chapters[0]!.title).toBe("Renamed elsewhere");
      expect(s().notice).toMatch(/could not be read/);
    });
  });

  describe("front and back matter", () => {
    const manifestOnDisk = () => JSON.parse(disk.get("cadabra.json")!);
    it("adds a title page with generated content, writes its file and opens it", async () => {
      await a().addMatter("front", "title-page");
      const entry = s().manifest!.frontMatter[0]!;
      expect(entry).toMatchObject({ id: "fm-1", kind: "title-page", title: "Title Page", file: "front-matter/01-title-page.json" });
      expect(s().currentId).toBe("fm-1");
      const doc = JSON.parse(disk.get("front-matter/01-title-page.json")!);
      expect(JSON.stringify(doc)).toContain("Book");
      expect(JSON.stringify(doc)).toContain("Me");
      expect(manifestOnDisk().frontMatter[0].kind).toBe("title-page");
      expect(JSON.stringify(s().currentDoc)).toContain("Me");
    });
    it("fills the copyright page from the manifest, including the ISBN when set", async () => {
      useProject.setState({ manifest: { ...s().manifest!, isbn: "978-3-16-148410-0" } });
      await a().addMatter("front", "copyright");
      const text = disk.get("front-matter/01-copyright.json")!;
      expect(text).toContain(`© ${new Date().getFullYear()} Me`);
      expect(text).toContain("All rights reserved.");
      expect(text).toContain("ISBN 978-3-16-148410-0");
    });
    it("refuses a second title page", async () => {
      await a().addMatter("front", "title-page");
      await expect(a().addMatter("front", "title-page")).rejects.toThrow(/title-page/);
      expect(s().manifest!.frontMatter).toHaveLength(1);
    });
    it("adds back matter and edits it with the same actions as chapters", async () => {
      await a().addMatter("back", "acknowledgments");
      await a().addMatter("back", "about-the-author");
      expect(s().manifest!.backMatter.map((e) => e.id)).toEqual(["bm-1", "bm-2"]);
      await a().rename("bm-2", "About Me");
      await a().move("bm-2", -1);
      expect(s().manifest!.backMatter.map((e) => e.title)).toEqual(["About Me", "Acknowledgments"]);
      expect(manifestOnDisk().backMatter[0].title).toBe("About Me");
      expect(s().manifest!.chapters.map((c) => c.id)).toEqual(["ch-1"]);
    });
    it("saves typing into the matter page and flushes it when switching", async () => {
      await a().addMatter("front", "dedication");
      a().setDraft(text("For Ada"));
      await a().selectChapter("ch-1");
      expect(disk.get("front-matter/01-dedication.json")).toContain("For Ada");
      expect(s().currentId).toBe("ch-1");
    });
    it("moves a matter page to the trash, never deleting it, and falls back to a chapter", async () => {
      await a().addMatter("front", "foreword");
      a().setDraft(text("precious foreword"));
      await a().flush();
      await a().remove("fm-1");
      expect(s().manifest!.frontMatter).toEqual([]);
      expect(disk.has("front-matter/01-foreword.json")).toBe(false);
      expect([...disk.keys()].some((k) => k.startsWith(".cadabra/trash/20260101-1200-front-matter__") && disk.get(k)!.includes("precious foreword"))).toBe(true);
      expect(s().currentId).toBe("ch-1");
    });
    it("reloads the open matter page after an outside change and keeps conflicting edits", async () => {
      await a().addMatter("front", "dedication");
      disk.set("front-matter/01-dedication.json", JSON.stringify(text("from sync")));
      await a().externalChange("front-matter/01-dedication.json");
      expect(JSON.stringify(s().currentDoc)).toContain("from sync");
      a().setDraft(text("mine"));
      disk.set("front-matter/01-dedication.json", JSON.stringify(text("again")));
      await a().externalChange("front-matter/01-dedication.json");
      expect(s().notice).toMatch(/keep both versions/);
    });
    it("exports front matter, chapters and back matter in reading order", async () => {
      await a().addMatter("front", "title-page");
      await a().addMatter("back", "about-the-author");
      await a().exportEpub();
      expect(disk.get("exports/book.epub")).toMatch(/^bytes:/);
      const files = unzipSync(written["exports/book.epub"]!);
      const opf = strFromU8(files["OEBPS/content.opf"]!);
      expect([...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1])).toEqual(["fm-1", "ch-1", "bm-1", "nav"]);
      expect(strFromU8(files["OEBPS/fm-1.xhtml"]!)).toContain('epub:type="frontmatter titlepage"');
      expect(strFromU8(files["OEBPS/bm-1.xhtml"]!)).toContain('epub:type="backmatter"');
    });
    it("opens a book whose first reading entry is front matter without a chapter", async () => {
      await a().addMatter("front", "dedication");
      await a().remove("ch-1");
      useProject.setState({ manifest: null, currentId: null, currentDoc: null });
      await a().openProject("/p");
      expect(s().currentId).toBe("fm-1");
    });
    it("upgrades a v1 project on open: backs up first, then saves as v3", async () => {
      const v1 = { ...manifestOnDisk(), formatVersion: 1 };
      disk.set("cadabra.json", JSON.stringify(v1));
      useProject.setState({ manifest: null, currentId: null, currentDoc: null, hashes: {} });
      await a().openProject("/p");
      expect(s().notice).toMatch(/upgraded from format 1/);
      expect(manifestOnDisk().formatVersion).toBe(3);
    });
  });
  describe("book details and cover", () => {
    const onDisk = () => JSON.parse(disk.get("cadabra.json")!);
    const form = () => { const m = s().manifest!; return { title: m.title, author: m.author, language: m.language, isbn: m.isbn ?? "", identifier: m.identifier, cover: m.cover }; };
    it("saves edited details, trims text and turns an empty ISBN into null", async () => {
      await a().updateDetails({ ...form(), title: "  New Title ", author: "Ann", language: "fr", isbn: " 978-3-16-148410-0 " });
      expect(onDisk()).toMatchObject({ title: "New Title", author: "Ann", language: "fr", isbn: "978-3-16-148410-0", cover: null });
      await a().updateDetails({ ...form(), isbn: "  " });
      expect(onDisk().isbn).toBeNull();
    });
    it("rejects an empty title or a cover outside assets/ and writes nothing", async () => {
      const before = disk.get("cadabra.json");
      await expect(a().updateDetails({ ...form(), title: " " })).rejects.toThrow(/title/);
      await expect(a().updateDetails({ ...form(), cover: "/Users/me/cover.png" })).rejects.toThrow(/cover/);
      await expect(a().updateDetails({ ...form(), cover: "assets/cover.gif" })).rejects.toThrow(/cover/);
      expect(disk.get("cadabra.json")).toBe(before);
    });
    it("does not rewrite the manifest when nothing changed", async () => {
      const before = disk.get("cadabra.json");
      await a().updateDetails(form());
      expect(disk.get("cadabra.json")).toBe(before);
    });
    it("copies a picked cover into assets/ and stores a relative path", async () => {
      picked = "/pics/front.JPG";
      const path = await a().importCover();
      expect(path).toBe("assets/front.JPG");
      expect(s().manifest!.cover).toBeNull(); // picking alone does not change the book
      await a().updateDetails({ ...form(), cover: "assets/front.jpg" });
      expect(onDisk().cover).toBe("assets/front.jpg");
    });
    it("refuses a gif or svg cover and an import failure, setting a notice", async () => {
      picked = "/pics/anim.gif";
      expect(await a().importCover()).toBeNull();
      expect(s().notice).toMatch(/PNG, JPEG or WebP/);
      picked = "/pics/c.png";
      importError = "too big";
      expect(await a().importCover()).toBeNull();
      expect(s().notice).toMatch(/too big/);
      picked = null;
      importError = null;
      expect(await a().importCover()).toBeNull();
    });
    it("removing the cover keeps the file in assets/", async () => {
      picked = "/pics/c.png";
      await a().updateDetails({ ...form(), cover: (await a().importCover())! });
      await a().updateDetails({ ...form(), cover: null });
      expect(onDisk().cover).toBeNull();
      expect(assets.has("assets/c.png")).toBe(true);
    });
  });
});

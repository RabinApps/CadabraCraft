import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, sampleChapter, seedBook } from "./helpers";

let s: Session;
afterEach(() => s.close());

const manifest = (path = "p") => JSON.parse(readFileSync(join(s.root, path, "cadabra.json"), "utf8"));
const fresh = async () => {
  s = await connect();
  await s.ok("cadabra_project_create", { path: "p", title: "T", author: "A" });
};

describe("chapter_add / rename / move / remove", () => {
  it("add writes the chapter file (heading + empty paragraph) and lists it in the manifest", async () => {
    await fresh();
    const r = await s.ok("cadabra_chapter_add", { path: "p", title: "Chapter One" });
    expect(r.chapter).toMatchObject({ id: "ch-1", title: "Chapter One", file: "manuscript/001-chapter-one.json" });
    const doc = JSON.parse(readFileSync(join(s.root, "p", r.chapter.file), "utf8"));
    expect(doc).toEqual({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] }, { type: "paragraph" }] });
    expect(manifest().chapters).toEqual([r.chapter]);
    const second = await s.ok("cadabra_chapter_add", { path: "p", title: "Two" });
    expect(second.chapter.id).toBe("ch-2");
  });

  it("rename changes only the title; the file keeps its name", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "Old" });
    const r = await s.ok("cadabra_chapter_rename", { path: "p", chapterId: a.chapter.id, title: "New" });
    expect(r.chapter).toMatchObject({ title: "New", file: a.chapter.file });
    expect(manifest().chapters[0]).toMatchObject({ title: "New", file: a.chapter.file });
    expect((await s.call("cadabra_chapter_rename", { path: "p", chapterId: "zzz", title: "x" })).data.error.code).toBe("chapter_not_found");
  });

  it("move reorders by delta (clamped) without renaming files", async () => {
    await fresh();
    for (const t of ["A", "B", "C"]) await s.ok("cadabra_chapter_add", { path: "p", title: t });
    const r = await s.ok("cadabra_chapter_move", { path: "p", chapterId: "ch-3", delta: -2 });
    expect(r.order.map((c: { title: string }) => c.title)).toEqual(["C", "A", "B"]);
    await s.ok("cadabra_chapter_move", { path: "p", chapterId: "ch-3", delta: 99 });
    expect(manifest().chapters.map((c: { title: string }) => c.title)).toEqual(["A", "B", "C"]);
    expect(manifest().chapters.map((c: { file: string }) => c.file)[2]).toContain("003-c");
  });

  it("remove saves the manifest, then moves the file to .cadabra/trash; the content survives", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "Keep Me" });
    await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc: sampleChapter() });
    const before = readFileSync(join(s.root, "p", a.chapter.file), "utf8");
    const r = await s.ok("cadabra_chapter_remove", { path: "p", chapterId: a.chapter.id });
    expect(r.trashedTo).toMatch(/^\.cadabra\/trash\/\d{8}-\d{4}-manuscript__001-keep-me\.json$/);
    expect(manifest().chapters).toEqual([]);
    expect(existsSync(join(s.root, "p", a.chapter.file))).toBe(false);
    expect(readFileSync(join(s.root, "p", r.trashedTo), "utf8")).toBe(before);
    expect((await s.call("cadabra_chapter_remove", { path: "p", chapterId: a.chapter.id })).data.error.code).toBe("chapter_not_found");
  });

  it("remove of a chapter whose file is already missing still removes it from the book", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "Ghost" });
    const { rmSync } = await import("node:fs");
    rmSync(join(s.root, "p", a.chapter.file));
    const r = await s.ok("cadabra_chapter_remove", { path: "p", chapterId: a.chapter.id });
    expect(r.trashedTo).toBeNull();
    expect(manifest().chapters).toEqual([]);
  });
});

describe("chapter_read", () => {
  it("returns JSON, plain text, word count and hash", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] }, { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world", marks: [{ type: "bold" }] }] }, { type: "paragraph", content: [{ type: "text", text: "Second." }] }] } });
    const r = await s.ok("cadabra_chapter_read", { path: "p", chapterId: a.chapter.id });
    expect(r.doc.type).toBe("doc");
    expect(r.text).toBe("One\n\nHello world\n\nSecond.");
    expect(r.words).toBe(4);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.chapter.id).toBe(a.chapter.id);
  });
  it("errors for an unknown id and for a missing file", async () => {
    await fresh();
    expect((await s.call("cadabra_chapter_read", { path: "p", chapterId: "nope" })).data.error.code).toBe("chapter_not_found");
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const { rmSync } = await import("node:fs");
    rmSync(join(s.root, "p", a.chapter.file));
    expect((await s.call("cadabra_chapter_read", { path: "p", chapterId: a.chapter.id })).data.error.code).toBe("chapter_missing");
  });
});

describe("chapter_write_markdown", () => {
  it("replaces the content via the importer, keeps the previous version as a backup, and returns the hash", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const r = await s.ok("cadabra_chapter_write_markdown", { path: "p", chapterId: a.chapter.id, markdown: "# One\n\nHello *there* **world**.\n\n* * *\n\nBye[^1]\n\n[^1]: A note." });
    const read = await s.ok("cadabra_chapter_read", { path: "p", chapterId: a.chapter.id });
    const types = read.doc.content.map((n: { type: string }) => n.type);
    expect(types).toEqual(["heading", "paragraph", "sceneBreak", "paragraph"]);
    expect(read.text).toContain("Hello there world.");
    expect(r.hash).toBe(read.hash);
    expect(r.backup).toMatch(/^\.cadabra\/backups\/\d{8}-\d{4}-manuscript__001-one\.json$/);
    expect(JSON.parse(readFileSync(join(s.root, "p", r.backup), "utf8")).content[0].content[0].text).toBe("One");
    const check = await s.ok("cadabra_project_validate", { path: "p" });
    expect(check.valid).toBe(true);
  });

  it("returns importer warnings (tables, raw html) and merges several chapters with a warning", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const r = await s.ok("cadabra_chapter_write_markdown", { path: "p", chapterId: a.chapter.id, markdown: "# A\n\ntext\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n# B\n\nmore" });
    const codes = r.warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain("table");
    expect(codes).toContain("multiple-chapters-merged");
    const read = await s.ok("cadabra_chapter_read", { path: "p", chapterId: a.chapter.id });
    expect(read.text).toContain("more");
    expect(read.doc.content.filter((n: { type: string }) => n.type === "heading")).toHaveLength(2);
  });

  it("keeps images that point at existing project assets and turns the rest into alt text with a warning", async () => {
    s = await connect();
    const { path, ids } = await seedBook(s);
    const r = await s.ok("cadabra_chapter_write_markdown", { path, chapterId: ids[0], markdown: "# T\n\n![Gradient](assets/gradient.png)\n\n![Remote](https://example.com/a.png)\n\n![Gone](assets/gone.png)\n\n![Local](../x.png)" });
    const read = await s.ok("cadabra_chapter_read", { path, chapterId: ids[0] });
    const images = read.doc.content.filter((n: { type: string }) => n.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].attrs.src).toBe("assets/gradient.png");
    expect(read.text).toContain("[Image: Gone]");
    expect(read.text).toContain("[Image: Local]");
    expect(r.warnings.filter((w: { code: string }) => w.code === "image-not-imported").length).toBeGreaterThanOrEqual(2);
    expect((await s.ok("cadabra_project_validate", { path })).valid).toBe(true);
  });

  it("refuses markdown with nothing importable and leaves the chapter untouched", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const before = readFileSync(join(s.root, "p", a.chapter.file), "utf8");
    const r = await s.call("cadabra_chapter_write_markdown", { path: "p", chapterId: a.chapter.id, markdown: "   \n" });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("empty_input");
    expect(readFileSync(join(s.root, "p", a.chapter.file), "utf8")).toBe(before);
  });
});

describe("chapter_write_json", () => {
  it("writes a valid doc", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const r = await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc: sampleChapter() });
    expect(r.words).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(s.root, "p", a.chapter.file), "utf8"))).toEqual(sampleChapter());
  });

  it("rejects schema-invalid docs before touching the file", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const file = join(s.root, "p", a.chapter.file);
    const before = readFileSync(file, "utf8");
    const bad: unknown[] = [
      { type: "doc", content: [{ type: "bogusNode" }] },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "strike" }] }] }] },
      { type: "doc", content: [{ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "x" }] }] },
      { type: "doc", content: [{ type: "text", text: "loose text" }] },
      { type: "paragraph" },
      "just a string",
      { type: "doc", content: [{ type: "image", attrs: { src: "https://x.test/a.png" } }] },
      { type: "doc", content: [{ type: "image", attrs: { src: "../etc/passwd.png" } }] },
    ];
    for (const doc of bad) {
      const r = await s.call("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc });
      expect(r.isError, JSON.stringify(doc)).toBe(true);
      expect(["invalid_chapter_doc", "invalid_input"], JSON.stringify(doc)).toContain(r.data?.error?.code ?? "invalid_input");
    }
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readdirSync(join(s.root, "p/manuscript"))).toEqual([a.chapter.file.split("/")[1]]);
  });

  it("is conflict-safe: an external change since baseHash is kept as a conflict copy", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const read = await s.ok("cadabra_chapter_read", { path: "p", chapterId: a.chapter.id });
    const file = join(s.root, "p", a.chapter.file);
    writeFileSync(file, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"edited elsewhere"}]}]}');
    const r = await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc: sampleChapter(), baseHash: read.hash });
    expect(r.conflictCopy).toMatch(/^manuscript\/001-one\.conflict-\d{8}-\d{4}\.json$/);
    expect(readFileSync(join(s.root, "p", r.conflictCopy), "utf8")).toContain("edited elsewhere");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(sampleChapter());
    // a second conflicting write in the same minute must not overwrite the first copy
    writeFileSync(file, "second external edit");
    const r2 = await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc: sampleChapter(), baseHash: r.hash });
    expect(r2.conflictCopy).not.toBe(r.conflictCopy);
    expect(readFileSync(join(s.root, "p", r.conflictCopy), "utf8")).toContain("edited elsewhere");
    expect(readFileSync(join(s.root, "p", r2.conflictCopy), "utf8")).toBe("second external edit");
  });

  it("with a matching baseHash writes cleanly and reports no conflict", async () => {
    await fresh();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
    const read = await s.ok("cadabra_chapter_read", { path: "p", chapterId: a.chapter.id });
    const r = await s.ok("cadabra_chapter_write_json", { path: "p", chapterId: a.chapter.id, doc: sampleChapter(), baseHash: read.hash });
    expect(r.conflictCopy).toBeNull();
  });

  it("serialises concurrent edits of one project so none is lost", async () => {
    await fresh();
    await Promise.all(Array.from({ length: 8 }, (_, i) => s.ok("cadabra_chapter_add", { path: "p", title: `Chapter ${i}` })));
    const m = manifest();
    expect(m.chapters).toHaveLength(8);
    expect(new Set(m.chapters.map((c: { id: string }) => c.id)).size).toBe(8);
    for (const c of m.chapters) expect(existsSync(join(s.root, "p", c.file))).toBe(true);
  });
});

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addEdition, parseManifest, serializeManifest } from "@cadabracraft/format";
import { type Session, connect } from "./helpers";

let s: Session;
afterEach(() => s.close());

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const at = (...p: string[]) => join(s.root, "p", ...p);
const manifest = () => parseManifest(readFileSync(at("cadabra.json"), "utf8")).manifest;

/** A book with two chapters and a French edition made the way the app does (copies of the source, marked untranslated). */
const withFrench = async () => {
  s = await connect();
  await s.ok("cadabra_project_create", { path: "p", title: "Book", author: "Me" });
  for (const title of ["One", "Two"]) {
    const a = await s.ok("cadabra_chapter_add", { path: "p", title });
    await s.ok("cadabra_chapter_write_json", {
      path: "p",
      chapterId: a.chapter.id,
      doc: doc(`Source ${title}`),
    });
  }
  const m = manifest();
  const fr = {
    language: "fr",
    title: "Livre",
    author: "Moi",
    identifier: "urn:uuid:fr",
    isbn: null,
    cover: null,
  };
  const { manifest: next, files } = addEdition(m, fr, "copy");
  for (const f of files) {
    mkdirSync(dirname(at(f.path)), { recursive: true });
    writeFileSync(at(f.path), readFileSync(at(f.from!), "utf8"));
  }
  writeFileSync(at("cadabra.json"), serializeManifest(next));
};

describe("language arguments", () => {
  it("chapter_read follows the language and says when the text is only a copy", async () => {
    await withFrench();
    const r = await s.ok("cadabra_chapter_read", { path: "p", chapterId: "ch-1", language: "fr" });
    expect(r.chapter).toMatchObject({
      language: "fr",
      translated: false,
      file: "manuscript/fr/001-one.json",
    });
    const src = await s.ok("cadabra_chapter_read", { path: "p", chapterId: "ch-1" });
    expect(src.chapter).toMatchObject({ language: "en", translated: true });
  });

  it("an unknown language is language_not_found", async () => {
    await withFrench();
    const r = await s.call("cadabra_chapter_read", {
      path: "p",
      chapterId: "ch-1",
      language: "de",
    });
    expect(r.data.error.code).toBe("language_not_found");
  });

  it("write_json in French writes the French file, marks it translated and leaves the source alone", async () => {
    await withFrench();
    await s.ok("cadabra_chapter_write_json", {
      path: "p",
      chapterId: "ch-1",
      doc: doc("Texte un"),
      language: "fr",
    });
    expect(readFileSync(at("manuscript/fr/001-one.json"), "utf8")).toContain("Texte un");
    expect(readFileSync(at("manuscript/001-one.json"), "utf8")).toContain("Source One");
    expect(manifest().chapters[0]!.untranslated).toBeUndefined();
    expect(manifest().chapters[1]!.untranslated).toEqual(["fr"]);
  });

  it("write_markdown creates the French file of a chapter added after the edition", async () => {
    await withFrench();
    const a = await s.ok("cadabra_chapter_add", { path: "p", title: "Three" });
    expect(manifest().chapters[2]!.files.fr).toBeUndefined();
    await s.ok("cadabra_chapter_write_markdown", {
      path: "p",
      chapterId: a.chapter.id,
      markdown: "# Trois\n\nTexte",
      language: "fr",
    });
    expect(manifest().chapters[2]!.files.fr).toBe("manuscript/fr/003-three.json");
    expect(existsSync(at("manuscript/fr/003-three.json"))).toBe(true);
  });

  it("rename in French changes only the French title", async () => {
    await withFrench();
    await s.ok("cadabra_chapter_rename", {
      path: "p",
      chapterId: "ch-1",
      title: "Un",
      language: "fr",
    });
    expect(manifest().chapters[0]!.titles).toEqual({ en: "One", fr: "Un" });
  });

  it("remove trashes every language's file", async () => {
    await withFrench();
    const r = await s.ok("cadabra_chapter_remove", { path: "p", chapterId: "ch-1" });
    expect(Object.keys(r.trashedFiles).sort()).toEqual(["en", "fr"]);
    expect(existsSync(at("manuscript/001-one.json"))).toBe(false);
    expect(existsSync(at("manuscript/fr/001-one.json"))).toBe(false);
    expect(readdirSync(at(".cadabra/trash"))).toHaveLength(2);
  });

  it("project_info reports progress per edition and per-entry translations", async () => {
    await withFrench();
    await s.ok("cadabra_chapter_write_json", {
      path: "p",
      chapterId: "ch-1",
      doc: doc("Un"),
      language: "fr",
    });
    const r = await s.ok("cadabra_project_info", { path: "p", language: "fr" });
    expect(r.language).toBe("fr");
    expect(r.editions).toEqual([
      { language: "en", title: "Book", translated: 2, total: 2 },
      { language: "fr", title: "Livre", translated: 1, total: 2 },
    ]);
    expect(r.entries[0].translations.fr).toEqual({
      file: "manuscript/fr/001-one.json",
      translated: true,
    });
    expect(r.entries[1].translations.fr.translated).toBe(false);
  });

  it("validate checks the translation files too", async () => {
    await withFrench();
    writeFileSync(at("manuscript/fr/001-one.json"), "{broken");
    const r = await s.ok("cadabra_project_validate", { path: "p" });
    expect(r.valid).toBe(false);
    expect(r.issues[0].message).toContain("fr/001-one");
  });
});

describe("export per language", () => {
  it("refuses untranslated pages, then writes exports/fr with the skip option", async () => {
    await withFrench();
    await s.ok("cadabra_chapter_write_json", {
      path: "p",
      chapterId: "ch-1",
      doc: doc("Texte un"),
      language: "fr",
    });
    const blocked = await s.call("cadabra_export_markdown", { path: "p", language: "fr" });
    expect(blocked.data.error.code).toBe("chapter_not_translated");
    expect(existsSync(at("exports/fr/book.md"))).toBe(false);
    const r = await s.ok("cadabra_export_markdown", {
      path: "p",
      language: "fr",
      skipUntranslated: true,
    });
    expect(r).toMatchObject({ file: "exports/fr/book.md", chapterCount: 1, skipped: ["ch-2"] });
    const md = readFileSync(at("exports/fr/book.md"), "utf8");
    expect(md).toContain("Texte un");
    expect(md).not.toContain("Source Two");
  });

  it("exports the source edition into exports/<source language>", async () => {
    await withFrench();
    const r = await s.ok("cadabra_export_markdown", { path: "p" });
    expect(r.file).toBe("exports/en/book.md");
    expect(r.skipped).toEqual([]);
  });

  it("builds a French EPUB with the edition's own title", async () => {
    await withFrench();
    for (const id of ["ch-1", "ch-2"])
      await s.ok("cadabra_chapter_write_json", {
        path: "p",
        chapterId: id,
        doc: doc(`Texte ${id}`),
        language: "fr",
      });
    const r = await s.ok("cadabra_export_epub", { path: "p", language: "fr" });
    expect(r.file).toBe("exports/fr/book.epub");
    const info = await s.ok("cadabra_inspect_epub", { path: "p", language: "fr" });
    expect(info).toMatchObject({ title: "Livre", author: "Moi", language: "fr" });
  });
});

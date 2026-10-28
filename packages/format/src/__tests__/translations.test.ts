import { describe, expect, it } from "vitest";
import {
  addChapter,
  addEdition,
  createManifest,
  FormatError,
  isTranslated,
  markTranslated,
  missingTranslations,
  parseManifest,
  serializeManifest,
  translationFile,
  translationProgress,
  validateManifest,
  type Edition,
  type Manifest,
} from "../index";

const fr: Edition = {
  language: "fr",
  title: "Le Quai",
  author: "A. Writer",
  identifier: "urn:uuid:fr",
  isbn: null,
  cover: null,
};

const book = (): Manifest => {
  const base = createManifest({
    title: "The Quay",
    author: "A. Writer",
    identifier: "urn:uuid:en",
  });
  return addChapter(addChapter(base, "One").manifest, "Two").manifest;
};

describe("translationFile", () => {
  it("puts the language folder before the file name", () => {
    expect(translationFile("manuscript/001-one.json", "fr")).toBe("manuscript/fr/001-one.json");
    expect(translationFile("front-matter/title-page.json", "de")).toBe(
      "front-matter/de/title-page.json",
    );
  });
});

describe("addEdition", () => {
  it("gives every entry a translation file, marked untranslated, with the source title", () => {
    const m = book();
    const { manifest, files } = addEdition(m, fr, "copy");
    expect(manifest.editions.map((e) => e.language)).toEqual(["en", "fr"]);
    expect(files.map((f) => f.path)).toEqual([
      "manuscript/fr/001-one.json",
      "manuscript/fr/002-two.json",
    ]);
    expect(files.every((f) => f.from !== null)).toBe(true);
    for (const c of manifest.chapters) {
      expect(c.untranslated).toEqual(["fr"]);
      expect(c.titles.fr).toBe(c.titles.en);
      expect(isTranslated(c, "fr", manifest.editions)).toBe(false);
    }
  });

  it("starts blank pages in empty mode", () => {
    const { files } = addEdition(book(), fr, "empty");
    expect(files.every((f) => f.from === null)).toBe(true);
  });

  it("leaves the source edition and its files alone", () => {
    const m = book();
    const { manifest } = addEdition(m, fr, "copy");
    expect(manifest.chapters.map((c) => c.files.en)).toEqual(m.chapters.map((c) => c.files.en));
    expect(isTranslated(manifest.chapters[0]!, "en", manifest.editions)).toBe(true);
  });

  it("refuses an edition that already exists", () => {
    const once = addEdition(book(), fr, "copy").manifest;
    expect(() => addEdition(once, fr, "empty")).toThrow(FormatError);
  });

  it("survives a save and reopen", () => {
    const { manifest } = addEdition(book(), fr, "copy");
    const again = parseManifest(serializeManifest(manifest)).manifest;
    expect(again).toEqual(manifest);
  });
});

describe("markTranslated and progress", () => {
  it("counts translated chapters per language", () => {
    let { manifest: m } = addEdition(book(), fr, "copy");
    expect(translationProgress(m, "fr")).toEqual({ translated: 0, total: 2 });
    m = markTranslated(m, m.chapters[0]!.id, "fr");
    expect(translationProgress(m, "fr")).toEqual({ translated: 1, total: 2 });
    expect(m.chapters[0]).not.toHaveProperty("untranslated");
    expect(translationProgress(m, "en")).toEqual({ translated: 2, total: 2 });
  });

  it("returns the same content when the entry is already translated", () => {
    const m = book();
    expect(markTranslated(m, m.chapters[0]!.id, "fr")).toEqual(m);
  });

  it("lists chapters with no file in a language yet", () => {
    const { manifest } = addEdition(book(), fr, "copy");
    const grown = addChapter(manifest, "Three").manifest;
    expect(missingTranslations(grown, "fr").map((e) => e.titles.en)).toEqual(["Three"]);
    expect(isTranslated(grown.chapters[2]!, "fr", grown.editions)).toBe(false);
  });
});

describe("validation of untranslated markers", () => {
  it("rejects a marker for an unknown language or the source", () => {
    const m = addEdition(book(), fr, "copy").manifest;
    const bad = (untranslated: string[]) =>
      validateManifest({
        ...m,
        chapters: [{ ...m.chapters[0]!, untranslated }, ...m.chapters.slice(1)],
      });
    expect(() => bad(["de"])).toThrow(/not a translation/);
    expect(() => bad(["en"])).toThrow(/not a translation/);
    expect(() => bad(["fr"])).not.toThrow();
  });
});

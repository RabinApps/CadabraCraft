import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  addChapter,
  addEdition,
  createManifest,
  exportDir,
  exportPlan,
  markTranslated,
  updateEdition,
  entryFile,
  FormatError,
  migrateV3ToV4,
  sourceEdition,
  translationFile,
  validateEditions,
  type EditionEntry,
} from "../index";

const v3Json = readFileSync(new URL("../fixtures/v3-cadabra.json", import.meta.url), "utf8");
const v3 = () => JSON.parse(v3Json) as Record<string, unknown>;

describe("migration v3 -> v4 (editions)", () => {
  it("moves the top-level metadata into the source edition", () => {
    const raw = v3();
    const v4 = migrateV3ToV4(raw);
    expect(v4.formatVersion).toBe(4);
    expect(v4.template).toBe(raw.template);
    expect(v4.editions).toEqual([
      {
        language: raw.language,
        title: raw.title,
        author: raw.author,
        identifier: raw.identifier,
        isbn: raw.isbn,
        cover: raw.cover,
      },
    ]);
    expect(v4).not.toHaveProperty("title");
    expect(v4).not.toHaveProperty("language");
  });

  it("keeps every entry and its path, under the source language, without moving files", () => {
    const raw = v3();
    const v4 = migrateV3ToV4(raw);
    const lang = String(raw.language);
    const chapters = raw.chapters as { id: string; file: string; title: string }[];
    const out = v4.chapters as EditionEntry[];
    expect(out.map((e) => e.id)).toEqual(chapters.map((c) => c.id));
    for (const [i, c] of chapters.entries()) {
      expect(out[i]!.files).toEqual({ [lang]: c.file });
      expect(out[i]!.titles).toEqual({ [lang]: c.title });
    }
  });

  it("keeps matter kinds and the entry counts", () => {
    const raw = v3();
    const v4 = migrateV3ToV4(raw);
    expect((v4.frontMatter as EditionEntry[]).length).toBe((raw.frontMatter as unknown[]).length);
    expect((v4.backMatter as EditionEntry[]).length).toBe((raw.backMatter as unknown[]).length);
    const front = raw.frontMatter as { kind?: string }[];
    for (const [i, e] of (v4.frontMatter as EditionEntry[]).entries())
      expect(e.kind).toBe(front[i]!.kind);
  });

  it("produces a valid edition set", () => {
    const v4 = migrateV3ToV4(v3());
    const entries = [
      ...(v4.frontMatter as EditionEntry[]),
      ...(v4.chapters as EditionEntry[]),
      ...(v4.backMatter as EditionEntry[]),
    ];
    const editions = v4.editions as Parameters<typeof validateEditions>[0];
    expect(() => validateEditions(editions, entries)).not.toThrow();
    expect(sourceEdition(editions).language).toBe("en");
    const first = (v4.chapters as EditionEntry[])[0]!;
    expect(entryFile(first, "en")).toBe(first.files.en);
    expect(entryFile(first, "fr")).toBeUndefined();
  });
});

describe("validateEditions", () => {
  const edition = {
    language: "en",
    title: "T",
    author: "A",
    identifier: "urn:uuid:x",
    isbn: null,
    cover: null,
  };
  const entry = (over: Partial<EditionEntry> = {}): EditionEntry => ({
    id: "c1",
    titles: { en: "One" },
    files: { en: "manuscript/001-one.json" },
    ...over,
  });

  it("accepts a translated entry", () => {
    const fr = { ...edition, language: "fr" };
    const e = entry({
      titles: { en: "One", fr: "Un" },
      files: { en: "manuscript/001-one.json", fr: "manuscript/fr/001-un.json" },
    });
    expect(() => validateEditions([edition, fr], [e])).not.toThrow();
  });

  it("rejects duplicate editions and an empty edition list", () => {
    expect(() => validateEditions([edition, edition], [])).toThrow(/duplicate/);
    expect(() => validateEditions([], [])).toThrow(FormatError);
  });

  it("rejects an entry without the source language", () => {
    expect(() => validateEditions([edition], [entry({ titles: {} })])).toThrow(/no en/);
  });

  it("rejects a file for an unknown edition and unsafe paths", () => {
    expect(() =>
      validateEditions(
        [edition],
        [entry({ files: { en: "manuscript/a.json", de: "manuscript/de/a.json" } })],
      ),
    ).toThrow(/unknown edition/);
    expect(() => validateEditions([edition], [entry({ files: { en: "../x.json" } })])).toThrow(
      /unsafe/,
    );
  });
});

describe("translationFile", () => {
  it("puts a translation in the language's folder, keeping the file name", () => {
    expect(translationFile("manuscript/001-chapter-one.json", "fr")).toBe(
      "manuscript/fr/001-chapter-one.json",
    );
    expect(translationFile("front-matter/title-page.json", "de")).toBe(
      "front-matter/de/title-page.json",
    );
    expect(translationFile("back-matter/about.json", "pt-BR")).toBe("back-matter/pt-BR/about.json");
  });
  it("refuses paths outside the page folders and language codes that are not folder names", () => {
    expect(() => translationFile("assets/a.png", "fr")).toThrow(FormatError);
    expect(() => translationFile("manuscript/a/b.json", "fr")).toThrow(FormatError);
    expect(() => translationFile("manuscript/001-a.json", "../x")).toThrow(/language/);
    expect(() => translationFile("manuscript/001-a.json", "")).toThrow(/language/);
  });
});

describe("export plan and edition details", () => {
  const book = () => {
    let m = createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });
    for (const t of ["One", "Two"]) m = addChapter(m, t).manifest;
    const fr = {
      language: "fr",
      title: "T",
      author: "A",
      identifier: "urn:uuid:y",
      isbn: null,
      cover: null,
    };
    m = addEdition(m, fr, "copy").manifest;
    return markTranslated(m, "ch-1", "fr");
  };
  it("blocks an export with untranslated pages unless skip is set", () => {
    const m = book();
    expect(() => exportPlan(m, "fr", false)).toThrow(/Two/);
    const p = exportPlan(m, "fr", true);
    expect(p.included.map((e) => e.id)).toEqual(["ch-1"]);
    expect(p.skipped.map((e) => e.id)).toEqual(["ch-2"]);
    expect(exportPlan(m, "en", false).skipped).toEqual([]);
    expect(() => exportPlan(m, "de", true)).toThrow(FormatError);
  });
  it("names the export folder per language and refuses odd codes", () => {
    expect(exportDir("fr")).toBe("exports/fr");
    expect(() => exportDir("../x")).toThrow(FormatError);
  });
  it("updates one edition's details only", () => {
    const m = updateEdition(book(), "fr", { title: "Titre", isbn: "123" });
    expect(m.editions[1]).toMatchObject({ title: "Titre", isbn: "123", language: "fr" });
    expect(m.editions[0]!.title).toBe("T");
    expect(() => updateEdition(m, "de", {})).toThrow(FormatError);
  });
});

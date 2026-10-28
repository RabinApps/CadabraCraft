import { describe, expect, it } from "vitest";
import {
  addChapter,
  addEdition,
  createManifest,
  entryRows,
  entryRowsIn,
  markTranslated,
  sourceFileById,
  sourceTitleById,
  type Edition,
} from "../index";

const fr: Edition = {
  language: "fr",
  title: "Le Quai",
  author: "A. Writer",
  identifier: "urn:uuid:fr",
  isbn: null,
  cover: null,
};

const book = () => {
  const base = createManifest({
    title: "The Quay",
    author: "A. Writer",
    identifier: "urn:uuid:en",
  });
  return addChapter(addChapter(base, "One").manifest, "Two").manifest;
};

describe("lookup by id", () => {
  it("finds the source file and title of an entry", () => {
    const m = book();
    expect(sourceFileById(m, "ch-1")).toBe(m.chapters[0]!.files.en);
    expect(sourceTitleById(m, "ch-2")).toBe("Two");
  });
  it("returns undefined for an unknown id", () => {
    const m = book();
    expect(sourceFileById(m, "nope")).toBeUndefined();
    expect(sourceTitleById(m, "nope")).toBeUndefined();
  });
});

describe("list rows", () => {
  it("builds source-language rows", () => {
    const m = book();
    expect(entryRows(m.chapters, m.editions)).toEqual([
      { id: "ch-1", title: "One", file: m.chapters[0]!.files.en },
      { id: "ch-2", title: "Two", file: m.chapters[1]!.files.en },
    ]);
  });
  it("builds rows in a language, with its own title and file when it has them", () => {
    const m = markTranslated(addEdition(book(), fr, "copy").manifest, "ch-1", "fr");
    const renamed = {
      ...m,
      chapters: m.chapters.map((c) =>
        c.id === "ch-1" ? { ...c, titles: { ...c.titles, fr: "Un" } } : c,
      ),
    };
    const rows = entryRowsIn(renamed.chapters, renamed.editions, "fr");
    expect(rows[0]).toEqual({
      id: "ch-1",
      title: "Un",
      file: renamed.chapters[0]!.files.fr,
      translated: true,
    });
    expect(rows[1]!.translated).toBe(false);
  });
  it("falls back to the source title and file when the language has none yet", () => {
    const m = addChapter(addEdition(book(), fr, "copy").manifest, "Three").manifest;
    const row = entryRowsIn(m.chapters, m.editions, "fr")[2]!;
    expect(row.title).toBe("Three");
    expect(row.file).toBe(m.chapters[2]!.files.en);
  });
});

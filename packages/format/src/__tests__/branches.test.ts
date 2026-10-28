import { describe, expect, it } from "vitest";
import v1 from "../fixtures/v1-cadabra.json";
import v2 from "../fixtures/v2-cadabra.json";
import v3 from "../fixtures/v3-cadabra.json";
import {
  addBackMatter,
  addChapter,
  addEdition,
  addFrontMatter,
  chapterFileName,
  createManifest,
  exportPlan,
  markTranslated,
  matterFileName,
  migrateV3ToV4,
  moveChapter,
  parseManifest,
  removeChapter,
  renameIn,
  restoreEntry,
  retargetFile,
  setTranslationFile,
  treeOf,
  updateEdition,
  validateManifest,
  type Edition,
  type Manifest,
} from "../index";

const base = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });
const fr: Edition = {
  language: "fr",
  title: "Le T",
  author: "A",
  identifier: "urn:uuid:2",
  isbn: null,
  cover: null,
};
type Raw = Record<string, unknown> & { editions: unknown; frontMatter: unknown; chapters: unknown };
const valid = () => JSON.parse(JSON.stringify(base())) as Raw;
const bad = (mutate: (o: Raw) => void, message: RegExp) => {
  const o = valid();
  mutate(o);
  expect(() => validateManifest(o)).toThrow(message);
};

describe("edit edge cases", () => {
  it("skips a chapter file name that a translation already uses", () => {
    const taken = `manuscript/${chapterFileName(1, "One")}`;
    const m: Manifest = {
      ...base(),
      backMatter: [{ id: "bm-1", titles: { en: "X" }, files: { en: taken } }],
    };
    expect(addChapter(m, "One").entry.files.en).toBe(`manuscript/${chapterFileName(2, "One")}`);
  });
  it("rejects moving an unknown chapter", () => {
    expect(() => moveChapter(base(), "ch-9", 1)).toThrow("no chapter ch-9");
  });
  it("skips a matter file name that is already taken", () => {
    let m = addChapter(base(), "x").manifest;
    m = {
      ...m,
      frontMatter: [
        {
          id: "fm-1",
          kind: "custom",
          titles: { en: "Note" },
          files: { en: `front-matter/${matterFileName(2, "Note")}` },
        },
      ],
    };
    const { entry } = addFrontMatter(m, "custom", "Note");
    expect(entry.files.en).toBe(`front-matter/${matterFileName(3, "Note")}`);
  });
  it("places a new front matter page before entries that sort later, treating a missing kind as custom", () => {
    const m: Manifest = {
      ...base(),
      frontMatter: [
        { id: "fm-1", titles: { en: "Old" }, files: { en: "front-matter/001-old.json" } },
      ],
    };
    expect(
      addFrontMatter(m, "dedication", "For you").manifest.frontMatter.map((e) => e.id),
    ).toEqual(["fm-2", "fm-1"]);
  });
  it("restores front matter and back matter files under fresh ids", () => {
    const front = restoreEntry(base(), "front-matter/001-note.json", "Note");
    expect(front.entry.id).toBe("fm-1");
    expect(front.manifest.frontMatter).toHaveLength(1);
    const back = restoreEntry(front.manifest, "back-matter/001-end.json", "End");
    expect(back.entry.id).toBe("bm-1");
    expect(back.manifest.backMatter).toHaveLength(1);
  });
  it("picks a restored id that no other section uses", () => {
    const m: Manifest = {
      ...base(),
      chapters: [{ id: "fm-1", titles: { en: "X" }, files: { en: "manuscript/001-x.json" } }],
    };
    expect(restoreEntry(m, "front-matter/001-note.json", "Note").entry.id).toBe("fm-2");
  });
  it("leaves entries with other files alone when retargeting", () => {
    const m = addChapter(addChapter(base(), "A").manifest, "B").manifest;
    const t = retargetFile(treeOf(m), "en", m.chapters[0]!.files.en!, "manuscript/new.json");
    expect(t.chapters[0]!.files.en).toBe("manuscript/new.json");
    expect(t.chapters[1]).toBe(m.chapters[1]);
  });
  it("adds back matter and removes chapters", () => {
    const m = addBackMatter(base(), "about-the-author", "About").manifest;
    expect(m.backMatter).toHaveLength(1);
    expect(removeChapter(addChapter(m, "x").manifest, "ch-1").manifest.chapters).toHaveLength(0);
  });
});

describe("translation edge cases", () => {
  it("keeps the other untranslated languages when one is marked translated", () => {
    let m = addChapter(base(), "One").manifest;
    m = addEdition(m, fr, "copy").manifest;
    m = addEdition(m, { ...fr, language: "de", identifier: "urn:uuid:3" }, "copy").manifest;
    m = markTranslated(m, "ch-1", "fr");
    expect(m.chapters[0]!.untranslated).toEqual(["de"]);
  });
  it("leaves an entry without an untranslated list unchanged", () => {
    const m = addChapter(base(), "One").manifest;
    expect(markTranslated(m, "ch-1", "fr")).toEqual(m);
  });
  it("renames a title and sets a translation file for one id only", () => {
    const m = addEdition(
      addChapter(addChapter(base(), "A").manifest, "B").manifest,
      fr,
      "copy",
    ).manifest;
    const r = renameIn(m, "ch-1", "fr", "Un");
    expect(r.chapters.map((c) => c.titles.fr)).toEqual(["Un", "B"]);
    const s = setTranslationFile(m, "ch-2", "fr", "manuscript/fr/x.json");
    expect(s.chapters.map((c) => c.files.fr)).toEqual([
      m.chapters[0]!.files.fr,
      "manuscript/fr/x.json",
    ]);
  });
  it("names an untranslated entry by its source title or id in the export error", () => {
    const m = addEdition(addChapter(base(), "One").manifest, fr, "copy").manifest;
    const noTitle: Manifest = {
      ...m,
      chapters: [{ ...m.chapters[0]!, titles: { en: "One" } }],
    };
    expect(() => exportPlan(noTitle, "fr", false)).toThrow("not translated into fr: One");
    const noSource: Manifest = { ...m, chapters: [{ ...m.chapters[0]!, titles: {} }] };
    expect(() => exportPlan(noSource, "fr", false)).toThrow("not translated into fr: ch-1");
  });
  it("refuses to update an unknown edition", () => {
    expect(() => updateEdition(base(), "fr", { title: "x" })).toThrow('no edition "fr"');
  });
});

describe("migration edge cases", () => {
  const v3 = (extra: Record<string, unknown>) => ({
    formatVersion: 3,
    title: "T",
    author: "A",
    language: "en",
    identifier: "urn:uuid:1",
    template: "novel",
    chapters: [{ id: "ch-1", title: "One", file: "manuscript/001-one.json" }],
    ...extra,
  });
  it("carries isbn and cover into the source edition", () => {
    const out = migrateV3ToV4(v3({ isbn: "978", cover: "assets/c.png" })) as {
      editions: Edition[];
    };
    expect(out.editions[0]).toMatchObject({ isbn: "978", cover: "assets/c.png" });
  });
  it("passes a non-array section through for validation to reject", () => {
    expect(migrateV3ToV4(v3({ frontMatter: "oops" })).frontMatter).toBe("oops");
  });
  it("rejects a JSON null manifest", () => {
    expect(() => parseManifest("null")).toThrow("formatVersion");
  });
});

describe("manifest validation", () => {
  it.each(["1a", "a b", "../x", "a/b", "a.b", "é", "x".repeat(65)])(
    "rejects the entry id %j (used as an XML id and file name by exports)",
    (id) => {
      bad(
        (o) => (o.chapters = [{ id, titles: { en: "A" }, files: { en: "a.json" } }]),
        /chapters\[0\]\.id" must start with a letter/,
      );
    },
  );
  it("rejects bad shapes", () => {
    bad((o) => (o.editions = "x"), /"editions" must be an array/);
    bad((o) => (o.editions = [null]), /editions\[0\]\.language/);
    bad((o) => (o.frontMatter = "x"), /"frontMatter" must be an array/);
    bad((o) => (o.chapters = [null]), /chapters\[0\]\.id/);
    bad(
      (o) => (o.chapters = [{ id: "a", titles: "x", files: {} }]),
      /"chapters\[0\]\.titles" must be an object/,
    );
    bad(
      (o) =>
        (o.chapters = [
          { id: "a", titles: { en: "A" }, files: { en: "a.json" }, untranslated: [1] },
        ]),
      /untranslated" must be a list/,
    );
    bad(
      (o) =>
        (o.chapters = [
          { id: "a", titles: { en: "A" }, files: { en: "a.json" }, untranslated: "fr" },
        ]),
      /untranslated" must be a list/,
    );
    bad(
      (o) =>
        (o.chapters = [{ id: "a", titles: { en: "A" }, files: { en: "a.json" }, kind: "custom" }]),
      /invalid kind/,
    );
  });
  it("rejects a missing manifest and a wrong version", () => {
    expect(() => validateManifest(null)).toThrow("unsupported formatVersion undefined");
    expect(() => validateManifest({ formatVersion: 3 })).toThrow("unsupported formatVersion 3");
  });
});

describe("legacy fixtures", () => {
  it("each one migrates to the current format", () => {
    for (const fixture of [v1, v2, v3])
      expect(parseManifest(JSON.stringify(fixture)).manifest.formatVersion).toBe(5);
  });
});

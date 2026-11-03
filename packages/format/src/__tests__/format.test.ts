import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CURRENT_FORMAT_VERSION,
  FormatError,
  chapterFileName,
  conflictFileName,
  createManifest,
  isSafeRelativePath,
  parseManifest,
  readingOrder,
  serializeManifest,
  validateManifest,
  type Manifest,
  type Migration,
} from "../index";

const base = (): Manifest => ({
  ...createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" }),
  chapters: [{ id: "c1", titles: { en: "A" }, files: { en: "manuscript/001-a.json" } }],
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("manifest", () => {
  it("creates a v8 book with one source edition and no references", () => {
    const m = createManifest({ title: "T", author: "A", language: "fr", identifier: "urn:uuid:x" });
    expect(m.formatVersion).toBe(8);
    expect(m.references).toEqual([]);
    expect(m.editions).toEqual([
      {
        language: "fr",
        title: "T",
        author: "A",
        identifier: "urn:uuid:x",
        isbn: null,
        cover: null,
      },
    ]);
    expect(m).not.toHaveProperty("title");
    expect(m).not.toHaveProperty("language");
  });
  it("round-trips through serialize and parse without migration", () => {
    const m = base();
    const r = parseManifest(serializeManifest(m));
    expect(r.manifest).toEqual(m);
    expect(r.migrated).toBe(false);
  });
  it("orders front matter, chapters, back matter", () => {
    const m = {
      ...base(),
      frontMatter: [{ id: "f", titles: { en: "T" }, files: { en: "front-matter/t.json" } }],
      backMatter: [{ id: "b", titles: { en: "B" }, files: { en: "back-matter/a.json" } }],
    };
    expect(readingOrder(m).map((e) => e.id)).toEqual(["f", "c1", "b"]);
  });
  it.each(["/abs.json", "../x.json", "a/../b.json", "C:/x.json", "a\\b.json", "a//b.json", ""])(
    "rejects unsafe path %j",
    (p) => {
      expect(isSafeRelativePath(p)).toBe(false);
    },
  );
  it("rejects unsafe file paths in the manifest", () => {
    const m = base();
    m.chapters[0]!.files.en = "../../etc/passwd";
    expect(() => validateManifest(m)).toThrow(FormatError);
  });
  it("rejects duplicate ids and missing fields", () => {
    const m = base();
    m.backMatter = [{ id: "c1", titles: { en: "X" }, files: { en: "back-matter/x.json" } }];
    expect(() => validateManifest(m)).toThrow(/duplicate/);
    expect(() => validateManifest({ ...base(), template: "" })).toThrow(/template/);
    expect(() => validateManifest({ ...base(), editions: [] })).toThrow(/edition/);
  });
  it("keeps an optional trimSize, and an old manifest without one is unchanged", () => {
    const withTrim = createManifest({
      title: "T",
      author: "A",
      identifier: "urn:uuid:x",
      trimSize: "6x9",
    });
    expect(validateManifest(JSON.parse(serializeManifest(withTrim))).trimSize).toBe("6x9");
    const plain = base();
    expect("trimSize" in plain).toBe(false);
    expect("trimSize" in validateManifest(plain)).toBe(false);
    expect(() => validateManifest({ ...base(), trimSize: "9x9" })).toThrow(/trimSize/);
  });
  it("keeps optional fonts through a round trip, and an old manifest without them is unchanged", () => {
    const withFonts = createManifest({
      title: "T",
      author: "A",
      identifier: "urn:uuid:x",
      fonts: { body: "EB Garamond", heading: "Inter" },
    });
    const back = validateManifest(JSON.parse(serializeManifest(withFonts)));
    expect(back.fonts).toEqual({ body: "EB Garamond", heading: "Inter" });
    const bodyOnly = { ...base(), fonts: { body: "Lora" } };
    expect(validateManifest(bodyOnly).fonts).toEqual({ body: "Lora" });
    const plain = base();
    expect("fonts" in plain).toBe(false);
    expect("fonts" in validateManifest(plain)).toBe(false);
    expect("fonts" in createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" })).toBe(
      false,
    );
  });
  it("refuses bad fonts values", () => {
    const bad = (fonts: unknown) => () => validateManifest({ ...base(), fonts });
    expect(bad("Lora")).toThrow(/fonts/);
    expect(bad(null)).toThrow(/fonts/);
    expect(bad(["Lora"])).toThrow(/fonts/);
    expect(bad({ body: "" })).toThrow(/fonts\.body/);
    expect(bad({ body: "   " })).toThrow(/fonts\.body/);
    expect(bad({ body: " Lora" })).toThrow(/fonts\.body/);
    expect(bad({ heading: 7 })).toThrow(/fonts\.heading/);
    expect(bad({ body: "A".repeat(101) })).toThrow(/fonts\.body/);
    expect(bad({ body: "Lo\nra" })).toThrow(/fonts\.body/);
    expect(bad({ body: "Lo\u0000ra" })).toThrow(/fonts\.body/);
    expect(bad({ mono: "Courier" })).toThrow(/fonts\.mono/);
    expect(() => validateManifest({ ...base(), fonts: { body: "A".repeat(100) } })).not.toThrow();
  });
  it("rejects an entry without a source title or file, and titles for unknown editions", () => {
    const m = base();
    m.chapters[0]!.titles = {};
    expect(() => validateManifest(m)).toThrow(/no en/);
    const n = base();
    n.chapters[0]!.titles = { en: "A", de: "A" };
    expect(() => validateManifest(n)).toThrow(/unknown edition "de"/);
  });
  it("rejects bad JSON and missing or newer versions", () => {
    expect(() => parseManifest("{nope")).toThrow(/invalid JSON/);
    expect(() => parseManifest("{}")).toThrow(/formatVersion/);
    expect(() =>
      parseManifest(JSON.stringify({ ...base(), formatVersion: CURRENT_FORMAT_VERSION + 1 })),
    ).toThrow(/newer/);
  });
});

describe("migration v1 -> v4 (front/back matter kinds, cover, editions)", () => {
  const v1Json = read("../fixtures/v1-cadabra.json");
  it("opens a real v1 manifest, upgrades it and loses nothing", () => {
    const v1 = JSON.parse(v1Json);
    expect(v1.formatVersion).toBe(1);
    const r = parseManifest(v1Json);
    expect(CURRENT_FORMAT_VERSION).toBe(8);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(1);
    expect(r.manifest.formatVersion).toBe(8);
    expect(r.manifest.editions[0]).toMatchObject({ language: v1.language, title: v1.title });
    expect(readingOrder(r.manifest).map((e) => e.id)).toEqual([
      "title-page",
      "ch-1",
      "ch-2",
      "about",
    ]);
  });
  it("serializes as v8 and reopens without migrating again", () => {
    const again = parseManifest(serializeManifest(parseManifest(v1Json).manifest));
    expect(again.migrated).toBe(false);
    expect(again.manifest.formatVersion).toBe(8);
  });
  it("validates kinds: unknown kinds, wrong section and kinds on chapters are rejected", () => {
    const m = base();
    const front = (kind: string) => [
      { id: "f", titles: { en: "A" }, files: { en: "front-matter/a.json" }, kind },
    ];
    const back = (kind: string) => [
      { id: "b", titles: { en: "A" }, files: { en: "back-matter/a.json" }, kind },
    ];
    expect(() => validateManifest({ ...m, frontMatter: front("bogus") })).toThrow(/kind/);
    expect(() => validateManifest({ ...m, frontMatter: front("colophon") })).toThrow(/kind/);
    expect(() => validateManifest({ ...m, backMatter: back("title-page") })).toThrow(/kind/);
    expect(() =>
      validateManifest({ ...m, chapters: [{ ...m.chapters[0]!, kind: "custom" }] }),
    ).toThrow(/kind/);
    const ok = validateManifest({
      ...m,
      frontMatter: front("custom"),
      backMatter: back("custom"),
    });
    expect(ok.frontMatter[0]!.kind).toBe("custom");
  });
});

describe("migration v2 -> v4 (cover, then editions)", () => {
  const v2Json = read("../fixtures/v2-cadabra.json");
  it("opens a real v2 manifest, moves its metadata into the source edition and loses nothing", () => {
    const v2 = JSON.parse(v2Json);
    expect(v2.formatVersion).toBe(2);
    const r = parseManifest(v2Json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(2);
    expect(r.manifest.formatVersion).toBe(8);
    expect(r.manifest.editions).toEqual([
      {
        language: v2.language,
        title: v2.title,
        author: v2.author,
        identifier: v2.identifier,
        isbn: v2.isbn,
        cover: null,
      },
    ]);
    expect(r.manifest.template).toBe(v2.template);
    expect(r.manifest.chapters.map((c) => c.titles)).toEqual(
      v2.chapters.map((c: { title: string }) => ({ en: c.title })),
    );
    expect(r.manifest.chapters.map((c) => c.files)).toEqual(
      v2.chapters.map((c: { file: string }) => ({ en: c.file })),
    );
    expect(r.manifest.backMatter[0]).toMatchObject({ kind: "about-the-author" });
  });
  it("reopens a v4 manifest without migrating", () => {
    const again = parseManifest(serializeManifest(parseManifest(v2Json).manifest));
    expect(again.migrated).toBe(false);
  });
});

describe("migration v3 -> v4 (real v3 project file)", () => {
  const v3Json = read("../fixtures/v3-cadabra.json");
  it("opens a real v3 manifest, migrates it to one source edition and keeps every file path", () => {
    const v3 = JSON.parse(v3Json);
    expect(v3.formatVersion).toBe(3);
    const r = parseManifest(v3Json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(3);
    expect(r.manifest.formatVersion).toBe(8);
    expect(r.manifest.editions).toHaveLength(1);
    expect(r.manifest.editions[0]).toEqual({
      language: "en",
      title: "The Long Quay",
      author: "A. Writer",
      identifier: v3.identifier,
      isbn: v3.isbn,
      cover: null,
    });
    expect(r.manifest.chapters).toEqual([
      {
        id: "ch-1",
        titles: { en: "Chapter One" },
        files: { en: "manuscript/001-chapter-one.json" },
      },
      {
        id: "ch-2",
        titles: { en: "Chapter Two" },
        files: { en: "manuscript/002-chapter-two.json" },
      },
    ]);
    expect(r.manifest.frontMatter[0]).toEqual({
      id: "title-page",
      kind: "title-page",
      titles: { en: "Title Page" },
      files: { en: "front-matter/title-page.json" },
    });
    expect(readingOrder(r.manifest).map((e) => e.id)).toEqual([
      "title-page",
      "ch-1",
      "ch-2",
      "about",
    ]);
  });
});

describe("shared contract fixtures (also read by Rust)", () => {
  it("reads the v3 manifest and migrates it", () => {
    const r = parseManifest(read("../../../../fixtures/contract/manifest-v3.json"));
    expect(r.migrated).toBe(true);
    expect(r.manifest.editions[0]!.language).toBe("en");
  });
  it("migrates the v4 manifest with a French translated chapter and adds an empty reference list", () => {
    const json = read("../../../../fixtures/contract/manifest-v4.json");
    const r = parseManifest(json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(4);
    expect(r.manifest.references).toEqual([]);
    expect(r.manifest.editions.map((e) => e.language)).toEqual(["en", "fr"]);
    expect(r.manifest.chapters[0]!.files.fr).toBe("manuscript/fr/001-chapitre-un.json");
    expect(r.manifest.chapters[1]!.files.fr).toBeUndefined();
  });
  it("migrates the v5 manifest to v8 and loses nothing", () => {
    const json = read("../../../../fixtures/contract/manifest-v5.json");
    const r = parseManifest(json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(5);
    expect(r.manifest.references.map((x) => x.file)).toEqual([
      "references/lighthouse-history.pdf",
      "references/harbour-at-dusk.mp4",
    ]);
    expect(r.manifest.editions.every((e) => e.publishing === undefined)).toBe(true);
    expect(JSON.parse(serializeManifest(r.manifest))).toEqual({
      ...JSON.parse(json),
      formatVersion: 8,
    });
  });
  it("migrates the v6 manifest with publishing details and changes only the version", () => {
    const json = read("../../../../fixtures/contract/manifest-v6.json");
    const r = parseManifest(json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(6);
    expect(r.manifest.editions[0]!.publishing).toMatchObject({
      publisher: "Quay Press",
      series: "Harbour Lights",
      seriesNumber: "1",
      published: "2026-11-03",
    });
    expect(r.manifest.editions[1]!.publishing).toBeUndefined();
    expect(JSON.parse(serializeManifest(r.manifest))).toEqual({
      ...JSON.parse(json),
      formatVersion: 8,
    });
  });

  it("migrates the v7 manifest, with a contents page, to v8 and changes only the version", () => {
    const json = read("../../../../fixtures/contract/manifest-v7.json");
    const r = parseManifest(json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(7);
    expect(r.manifest.frontMatter.at(-1)!.toc).toMatchObject({ depth: 1 });
    expect(r.manifest.dropCap).toBeUndefined();
    expect(r.manifest.chapters.every((c) => c.dropCap === undefined && c.icon === undefined)).toBe(
      true,
    );
    expect(JSON.parse(serializeManifest(r.manifest))).toEqual({
      ...JSON.parse(json),
      formatVersion: 8,
    });
  });
});

describe("cover", () => {
  const withCover = (cover: string | null) => ({
    ...base(),
    editions: [{ ...base().editions[0]!, cover }],
  });
  it("accepts null and assets/<name> images", () => {
    expect(validateManifest(base()).editions[0]!.cover).toBeNull();
    for (const c of [
      "assets/cover.jpg",
      "assets/cover-2.PNG".toLowerCase(),
      "assets/my_cover.webp",
      "assets/c.jpeg",
    ]) {
      expect(validateManifest(withCover(c)).editions[0]!.cover).toBe(c);
    }
  });
  it.each([
    "cover.jpg",
    "/assets/cover.jpg",
    "../assets/cover.jpg",
    "assets/sub/cover.jpg",
    "assets/cover.gif",
    "assets/cover.svg",
    "assets/cover",
    "https://x.test/c.jpg",
    "C:/c.jpg",
    "",
  ])("rejects cover %j", (c) => {
    expect(() => validateManifest(withCover(c))).toThrow(FormatError);
  });
});

describe("migrations", () => {
  // Stand-in for a future bump: the framework must upgrade in order and flag `migrated`.
  const v1: Record<string, unknown> = { ...base(), formatVersion: 1 };
  const up: Migration[] = [{ from: 1, up: (r) => ({ ...r, template: "modern" }) }];
  it("applies migrations and reports migrated", () => {
    const r = parseManifest(JSON.stringify(v1), up, 2);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(1);
  });
  it("fails when a step is missing instead of guessing", () => {
    expect(() => parseManifest(JSON.stringify(v1), [], 2)).toThrow(/no migration from version 1/);
  });
});

describe("names", () => {
  it("builds chapter file names", () => {
    expect(chapterFileName(1, "Chapter One")).toBe("001-chapter-one.json");
    expect(chapterFileName(12, "Café: Déjà vu!")).toBe("012-cafe-deja-vu.json");
    expect(chapterFileName(3, "???")).toBe("003-untitled.json");
  });
  it("keeps letters from non-Latin scripts", () => {
    expect(chapterFileName(1, "פרק ראשון")).toBe("001-פרק-ראשון.json");
    expect(chapterFileName(2, "الفصل الأول")).toBe("002-الفصل-الأول.json");
    expect(chapterFileName(3, "第一章：はじまり")).toBe("003-第一章-はじまり.json");
    expect(chapterFileName(4, "Глава первая")).toBe("004-глава-первая.json");
    expect(chapterFileName(5, "が")).toBe("005-が.json"); // voiced kana stays composed
  });
  it("never cuts a character in half or leaves a trailing dash when truncating", () => {
    const name = chapterFileName(1, "😀".repeat(3) + "あ".repeat(60));
    expect(name).toMatch(/^001-あ{48}\.json$/);
    expect(chapterFileName(1, `${"a".repeat(47)} b`)).toBe(`001-${"a".repeat(47)}.json`);
  });
  it("builds conflict file names", () => {
    expect(conflictFileName("manuscript/001-a.json", new Date(Date.UTC(2026, 9, 25, 17, 44)))).toBe(
      "manuscript/001-a.conflict-20261025-1744.json",
    );
  });
});

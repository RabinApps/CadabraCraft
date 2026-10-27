import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CURRENT_FORMAT_VERSION, FormatError, chapterFileName, conflictFileName, createManifest, isSafeRelativePath,
  parseManifest, readingOrder, serializeManifest, validateManifest, type Migration,
} from "../index";

const base = () => ({ ...createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" }), chapters: [{ id: "c1", file: "manuscript/001-a.json", title: "A" }] });

describe("manifest", () => {
  it("round-trips through serialize and parse without migration", () => {
    const m = base();
    const r = parseManifest(serializeManifest(m));
    expect(r.manifest).toEqual(m);
    expect(r.migrated).toBe(false);
  });
  it("orders front matter, chapters, back matter", () => {
    const m = { ...base(), frontMatter: [{ id: "f", file: "front-matter/t.json", title: "T" }], backMatter: [{ id: "b", file: "back-matter/a.json", title: "B" }] };
    expect(readingOrder(m).map((e) => e.id)).toEqual(["f", "c1", "b"]);
  });
  it.each(["/abs.json", "../x.json", "a/../b.json", "C:/x.json", "a\\b.json", "a//b.json", ""])("rejects unsafe path %j", (p) => {
    expect(isSafeRelativePath(p)).toBe(false);
  });
  it("rejects unsafe file paths in the manifest", () => {
    const m = base();
    m.chapters[0]!.file = "../../etc/passwd";
    expect(() => validateManifest(m)).toThrow(FormatError);
  });
  it("rejects duplicate ids and missing fields", () => {
    const m = base();
    m.backMatter = [{ id: "c1", file: "back-matter/x.json", title: "X" }];
    expect(() => validateManifest(m)).toThrow(/duplicate/);
    expect(() => validateManifest({ ...base(), title: "" })).toThrow(/title/);
  });
  it("rejects bad JSON and missing or newer versions", () => {
    expect(() => parseManifest("{nope")).toThrow(/invalid JSON/);
    expect(() => parseManifest("{}")).toThrow(/formatVersion/);
    expect(() => parseManifest(JSON.stringify({ ...base(), formatVersion: CURRENT_FORMAT_VERSION + 1 }))).toThrow(/newer/);
  });
});

describe("migration v1 -> v2 (front/back matter kinds)", () => {
  const v1Json = readFileSync(new URL("../fixtures/v1-cadabra.json", import.meta.url), "utf8");
  it("opens a real v1 manifest, upgrades it and loses nothing", () => {
    const v1 = JSON.parse(v1Json);
    expect(v1.formatVersion).toBe(1);
    const r = parseManifest(v1Json);
    expect(CURRENT_FORMAT_VERSION).toBe(3);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(1);
    expect(r.manifest.formatVersion).toBe(3);
    const { formatVersion: _a, ...before } = v1;
    const { formatVersion: _b, ...after } = r.manifest;
    expect(after).toEqual({ ...before, cover: null }); // only cover is added: no kind, every field and entry kept
    expect(r.manifest.frontMatter[0]).not.toHaveProperty("kind");
    expect(readingOrder(r.manifest).map((e) => e.id)).toEqual(["title-page", "ch-1", "ch-2", "about"]);
  });
  it("serializes as v3 and reopens without migrating again", () => {
    const again = parseManifest(serializeManifest(parseManifest(v1Json).manifest));
    expect(again.migrated).toBe(false);
    expect(again.manifest.formatVersion).toBe(3);
  });
  it("validates kinds: unknown kinds, wrong section and kinds on chapters are rejected", () => {
    const m = base();
    expect(() => validateManifest({ ...m, frontMatter: [{ id: "f", file: "front-matter/a.json", title: "A", kind: "bogus" }] })).toThrow(/kind/);
    expect(() => validateManifest({ ...m, frontMatter: [{ id: "f", file: "front-matter/a.json", title: "A", kind: "colophon" }] })).toThrow(/kind/);
    expect(() => validateManifest({ ...m, backMatter: [{ id: "b", file: "back-matter/a.json", title: "A", kind: "title-page" }] })).toThrow(/kind/);
    expect(() => validateManifest({ ...m, chapters: [{ ...m.chapters[0]!, kind: "custom" }] })).toThrow(/kind/);
    const ok = validateManifest({ ...m, frontMatter: [{ id: "f", file: "front-matter/a.json", title: "A", kind: "custom" }], backMatter: [{ id: "b", file: "back-matter/a.json", title: "A", kind: "custom" }] });
    expect(ok.frontMatter[0]!.kind).toBe("custom");
  });
});

describe("migration v2 -> v3 (cover)", () => {
  const v2Json = readFileSync(new URL("../fixtures/v2-cadabra.json", import.meta.url), "utf8");
  it("opens a real v2 manifest, adds cover: null and loses nothing", () => {
    const v2 = JSON.parse(v2Json);
    expect(v2.formatVersion).toBe(2);
    const r = parseManifest(v2Json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(2);
    expect(r.manifest.formatVersion).toBe(3);
    expect(r.manifest.cover).toBeNull();
    const { formatVersion: _a, ...before } = v2;
    const { formatVersion: _b, cover: _c, ...after } = r.manifest;
    expect(after).toEqual(before); // kinds, isbn and every entry kept
  });
  it("reopens a v3 manifest without migrating", () => {
    const again = parseManifest(serializeManifest(parseManifest(v2Json).manifest));
    expect(again.migrated).toBe(false);
  });
});

describe("cover", () => {
  it("accepts null and assets/<name> images", () => {
    expect(validateManifest(base()).cover).toBeNull();
    for (const c of ["assets/cover.jpg", "assets/cover-2.PNG".toLowerCase(), "assets/my_cover.webp", "assets/c.jpeg"]) {
      expect(validateManifest({ ...base(), cover: c }).cover).toBe(c);
    }
  });
  it.each(["cover.jpg", "/assets/cover.jpg", "../assets/cover.jpg", "assets/sub/cover.jpg", "assets/cover.gif", "assets/cover.svg", "assets/cover", "https://x.test/c.jpg", "C:/c.jpg", ""])("rejects cover %j", (c) => {
    expect(() => validateManifest({ ...base(), cover: c })).toThrow(FormatError);
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
    expect(conflictFileName("manuscript/001-a.json", new Date(Date.UTC(2026, 9, 25, 17, 44)))).toBe("manuscript/001-a.conflict-20261025-1744.json");
  });
});

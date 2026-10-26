import { describe, expect, it } from "vitest";
import {
  CURRENT_FORMAT_VERSION, FormatError, chapterFileName, conflictFileName, createManifest, isSafeRelativePath,
  parseManifest, readingOrder, serializeManifest, validateManifest, type Migration,
} from "./index";

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

describe("migrations", () => {
  // Stand-in for a future v1 -> v2 bump: the framework must upgrade in order and flag `migrated`.
  const v1: Record<string, unknown> = { ...base() };
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
  it("builds conflict file names", () => {
    expect(conflictFileName("manuscript/001-a.json", new Date(Date.UTC(2026, 9, 25, 17, 44)))).toBe("manuscript/001-a.conflict-20261025-1744.json");
  });
});

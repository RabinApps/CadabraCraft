import { describe, expect, it } from "vitest";
import {
  FormatError,
  PUBLISHING_LIMITS,
  createManifest,
  isPublishingEmpty,
  migrateV5ToV6,
  parseManifest,
  serializeManifest,
  updateEdition,
  validateManifest,
  validatePublishing,
} from "../index";

const bad = (v: unknown) => expect(() => validatePublishing(v)).toThrow(FormatError);

describe("validatePublishing", () => {
  it("accepts every key and returns only what is set", () => {
    const full = {
      publisher: "Quay Press",
      description: "Line one.\nLine two.",
      subjects: ["FIC014000", "Lighthouses"],
      series: "Harbour Lights",
      seriesNumber: "2.5",
      rights: "© 2026 A. Writer",
      published: "2026-02-28",
    };
    expect(validatePublishing(full)).toEqual(full);
    expect(validatePublishing({})).toEqual({});
    expect(validatePublishing({ publisher: "X" })).toEqual({ publisher: "X" });
  });
  it("refuses a non-object, an unknown key and wrong types", () => {
    for (const v of [null, [], "x", 3]) bad(v);
    bad({ colour: "red" });
    bad({ publisher: 3 });
    bad({ subjects: "a" });
    bad({ series: "S", seriesNumber: 1 });
  });
  it("keeps single-line values trimmed, non-empty and within their limits", () => {
    for (const k of ["publisher", "series", "rights"] as const) {
      bad({ [k]: "" });
      bad({ [k]: " padded " });
      bad({ [k]: "two\nlines" });
      bad({ [k]: "x".repeat(PUBLISHING_LIMITS[k] + 1) });
      expect(validatePublishing({ [k]: "x".repeat(PUBLISHING_LIMITS[k]) })[k]).toHaveLength(
        PUBLISHING_LIMITS[k],
      );
    }
  });
  it("allows line breaks only in the description, within its limit", () => {
    bad({ description: "" });
    bad({ description: " x" });
    bad({ description: "a\u0000b" });
    bad({ description: 3 });
    bad({ description: "x".repeat(PUBLISHING_LIMITS.description + 1) });
    expect(validatePublishing({ description: "a\n\nb" }).description).toBe("a\n\nb");
  });
  it("checks the subject list: non-empty, bounded, single-line and distinct", () => {
    bad({ subjects: [] });
    bad({ subjects: [""] });
    bad({ subjects: ["a", "a"] });
    bad({ subjects: ["a\nb"] });
    bad({ subjects: ["x".repeat(PUBLISHING_LIMITS.subject + 1)] });
    bad({ subjects: Array.from({ length: PUBLISHING_LIMITS.subjects + 1 }, (_, i) => `s${i}`) });
    expect(
      validatePublishing({
        subjects: Array.from({ length: PUBLISHING_LIMITS.subjects }, (_, i) => `s${i}`),
      }).subjects,
    ).toHaveLength(PUBLISHING_LIMITS.subjects);
  });
  it("needs a series for a series number, and a plain number", () => {
    bad({ seriesNumber: "1" });
    for (const n of ["", "x", "-1", "1.", ".5", "1,5", "1.2345", "1234567"])
      bad({ series: "S", seriesNumber: n });
    for (const n of ["1", "12", "2.5", "0.5"])
      expect(validatePublishing({ series: "S", seriesNumber: n }).seriesNumber).toBe(n);
  });
  it("accepts only real calendar dates", () => {
    for (const d of [
      "2026-02-29",
      "2026-13-01",
      "2026-00-10",
      "26-01-01",
      "2026-1-1",
      "",
      20260101,
    ])
      bad({ published: d });
    expect(validatePublishing({ published: "2024-02-29" }).published).toBe("2024-02-29");
  });
  it("reports where the problem is", () => {
    expect(() => validatePublishing({ colour: 1 }, "editions[1].publishing")).toThrow(
      "editions[1].publishing.colour",
    );
  });
});

describe("isPublishingEmpty", () => {
  it("is true for nothing or no keys", () => {
    expect(isPublishingEmpty(undefined)).toBe(true);
    expect(isPublishingEmpty({})).toBe(true);
    expect(isPublishingEmpty({ publisher: "P" })).toBe(false);
  });
});

describe("publishing in the manifest", () => {
  const book = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });
  it("migrates v5 to v6 as a copy that keeps every key", () => {
    const raw = { a: 1, editions: [{ language: "en" }] };
    expect(migrateV5ToV6(raw)).toEqual(raw);
    expect(migrateV5ToV6(raw)).not.toBe(raw);
  });
  it("opens a v5 book from disk, upgrades it and keeps its content", () => {
    const v5 = { ...book(), formatVersion: 5 };
    const r = parseManifest(JSON.stringify(v5));
    expect(r.migrated).toBe(true);
    expect(r.manifest.formatVersion).toBe(12);
    expect(r.manifest.editions).toEqual(v5.editions);
  });
  it("saves and reopens an edition's publishing", () => {
    const m = updateEdition(book(), "en", { publishing: { publisher: "P", subjects: ["a"] } });
    const again = parseManifest(serializeManifest(m));
    expect(again.migrated).toBe(false);
    expect(again.manifest.editions[0]!.publishing).toEqual({ publisher: "P", subjects: ["a"] });
  });
  it("drops an empty publishing and refuses a bad one with its position", () => {
    const m = book();
    const empty = { ...m, editions: [{ ...m.editions[0]!, publishing: {} }] };
    expect(validateManifest(empty).editions[0]).not.toHaveProperty("publishing");
    const wrong = { ...m, editions: [{ ...m.editions[0]!, publishing: { published: "soon" } }] };
    expect(() => validateManifest(wrong)).toThrow("editions[0].publishing.published");
  });
});

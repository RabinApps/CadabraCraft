import { describe, expect, it } from "vitest";
import { kinded } from "./kinded";
import {
  CURRENT_FORMAT_VERSION,
  FormatError,
  MIGRATIONS,
  customKey,
  entryIdOfKey,
  headingKey,
  isCustomKey,
  migrateV6ToV7,
  normalizeHeadingText,
  outlineKeys,
  parseManifest,
  serializeManifest,
  validateManifest,
  validateToc,
  type TocSettings,
} from "../index";
import { book, entryOf, o } from "./tocFixtures";

describe("manifest toc validation", () => {
  const good = (): TocSettings => ({
    depth: 2,
    pageNumbers: false,
    parts: true,
    hidden: ["ch-1"],
    titles: { "ch-1": { en: "Prologue" } },
    order: ["ch-2", "ch-1"],
    custom: [{ id: "c-1", titles: { en: "Map" }, after: "ch-1", target: "ch-2" }],
  });
  const withToc = (toc: unknown, kind: unknown = "contents") => {
    const { m } = book();
    const raw = JSON.parse(JSON.stringify(m));
    raw.frontMatter[1] = { ...raw.frontMatter[1], kind, toc };
    return raw;
  };

  it("accepts every field and keeps them through serialisation", () => {
    const { m, toc } = book();
    const next = {
      ...m,
      frontMatter: m.frontMatter.map((e) => (e.id === toc ? { ...e, toc: good() } : e)),
    };
    const again = parseManifest(serializeManifest(next));
    expect(again.migrated).toBe(false);
    expect(entryOf(again.manifest, toc).toc).toEqual(good());
  });
  it("accepts the minimum (no order, no target) and a contents page without toc", () => {
    const min = { depth: 0, pageNumbers: true, hidden: [], titles: {}, custom: [] };
    expect(validateToc(min)).toEqual({ ...min, parts: true });
    expect(() => validateManifest(withToc(undefined))).not.toThrow();
    expect(validateManifest(withToc(undefined)).frontMatter[1]!.toc).toBeUndefined();
  });
  it.each([0, 1, 2, 3])("accepts depth %i", (depth) => {
    expect(validateToc({ ...good(), depth }).depth).toBe(depth);
  });
  it.each([-1, 4, 1.5, "2", null, undefined])("rejects depth %s", (depth) => {
    expect(() => validateToc({ ...good(), depth })).toThrow(/depth/);
  });
  it.each([["yes"], [1], [undefined]])("rejects pageNumbers %s", (pageNumbers) => {
    expect(() => validateToc({ ...good(), pageNumbers })).toThrow(/pageNumbers/);
  });
  it("rejects a toc that is not an object or has an unknown key", () => {
    for (const bad of [null, [], "x", 3]) expect(() => validateToc(bad)).toThrow(FormatError);
    expect(() => validateToc({ ...good(), extra: 1 })).toThrow(/unknown key "toc.extra"/);
  });
  it("rejects bad hidden and order lists", () => {
    for (const hidden of ["ch-1", [1], [""], ["a", "a"], undefined])
      expect(() => validateToc({ ...good(), hidden })).toThrow(/hidden/);
    for (const order of ["x", [2], [""], ["a", "a"], null])
      expect(() => validateToc({ ...good(), order })).toThrow(/order/);
  });
  it("rejects bad titles", () => {
    for (const titles of [undefined, null, [], "x"])
      expect(() => validateToc({ ...good(), titles })).toThrow(/titles/);
    expect(() => validateToc({ ...good(), titles: { a: "x" } })).toThrow(/titles\.a/);
    expect(() => validateToc({ ...good(), titles: { a: { en: 3 } } })).toThrow(/titles\.a\.en/);
    expect(() => validateToc({ ...good(), titles: { a: { en: "" } } })).toThrow(/non-empty/);
  });
  it("rejects bad custom entries", () => {
    const c = { id: "c-1", titles: { en: "Map" }, after: "ch-1" };
    for (const custom of [undefined, {}, "x"])
      expect(() => validateToc({ ...good(), custom })).toThrow(/custom/);
    const bad = (patch: Record<string, unknown>) =>
      validateToc({ ...good(), custom: [{ ...c, ...patch }] });
    expect(() => validateToc({ ...good(), custom: [null] })).toThrow(/custom\[0\]/);
    expect(() => bad({ extra: 1 })).toThrow(/unknown key "toc.custom\[0\].extra"/);
    expect(() => bad({ id: undefined })).toThrow(/id/);
    expect(() => bad({ id: "1bad" })).toThrow(/id/);
    expect(() => bad({ titles: {} })).toThrow(/at least one language/);
    expect(() => bad({ titles: { en: 1 } })).toThrow(/titles/);
    expect(() => bad({ after: "" })).toThrow(/after/);
    expect(() => bad({ after: 4 })).toThrow(/after/);
    expect(() => bad({ target: "" })).toThrow(/target/);
    expect(() => validateToc({ ...good(), custom: [c, { ...c }] })).toThrow(/duplicate custom/);
    expect(validateToc({ ...good(), custom: [c] }).custom[0]).toEqual(c);
  });
  it("only accepts toc on a contents page", () => {
    expect(() => validateManifest(withToc(good(), "custom"))).toThrow(/contents page only/);
    const noKind = withToc(good());
    delete noKind.frontMatter[1].kind;
    expect(() => validateManifest(noKind)).toThrow(/contents page only/);
    expect(validateManifest(withToc(good())).frontMatter[1]!.toc).toEqual(good());
  });
  it("names the entry in errors", () => {
    expect(() => validateManifest(withToc({ ...good(), depth: 9 }))).toThrow(
      /frontMatter\[1\]\.toc\.depth/,
    );
  });
  it("refuses contents in the back matter", () => {
    const { m } = book();
    const raw = JSON.parse(JSON.stringify(m));
    raw.backMatter[0].kind = "contents";
    expect(() => validateManifest(raw)).toThrow(/invalid kind/);
  });
});

describe("migration v6 -> v7", () => {
  const v6 = () => {
    const { m } = book();
    return { ...JSON.parse(JSON.stringify(m)), formatVersion: 6 };
  };
  it("is registered after v5 -> v6 and the current version is 12", () => {
    expect(CURRENT_FORMAT_VERSION).toBe(13);
    expect(MIGRATIONS.find((x) => x.from === 6)?.up).toBe(migrateV6ToV7);
  });
  it("copies the manifest without changing any key", () => {
    const raw = { a: 1, editions: [{ language: "en" }] };
    expect(migrateV6ToV7(raw)).toEqual(raw);
    expect(migrateV6ToV7(raw)).not.toBe(raw);
  });
  it("opens a v6 book, upgrades it and keeps every field", () => {
    const raw = v6();
    raw.trimSize = "6x9";
    raw.fonts = { body: "EB Garamond" };
    raw.editions[0].publishing = { publisher: "P" };
    const r = parseManifest(JSON.stringify(raw));
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(6);
    expect(JSON.parse(serializeManifest(r.manifest))).toEqual({
      ...kinded(raw),
      formatVersion: 13,
    });
    expect(entryOf(r.manifest, "fm-2").toc).toBeUndefined();
  });
  it("refuses a manifest from a newer version", () => {
    const raw = { ...v6(), formatVersion: CURRENT_FORMAT_VERSION + 1 };
    expect(() => parseManifest(JSON.stringify(raw))).toThrow(
      new RegExp(`newer than this app supports \\(${CURRENT_FORMAT_VERSION}\\)`),
    );
  });
  it("a current book reopens without migrating", () => {
    const { m } = book();
    expect(parseManifest(serializeManifest(m)).migrated).toBe(false);
  });
});

describe("item keys", () => {
  it("normalises text", () => {
    expect(normalizeHeadingText("  The   STORM\n")).toBe("the storm");
    expect(normalizeHeadingText("Café")).toBe(normalizeHeadingText("Café"));
  });
  it("builds heading and custom keys", () => {
    expect(headingKey("ch-1", 2, " The  Storm ", 1)).toBe("ch-1#2:the storm:1");
    expect(customKey("c-1")).toBe("custom:c-1");
    expect(isCustomKey("custom:c-1")).toBe(true);
    expect(isCustomKey("ch-1")).toBe(false);
    expect(entryIdOfKey("ch-1#2:a#b:0")).toBe("ch-1");
    expect(entryIdOfKey("ch-1")).toBe("ch-1");
  });
  it("numbers identical headings by occurrence and survives edits elsewhere", () => {
    const outline = [o(0, 1, "Same"), o(1, 2, "Same"), o(2, 1, "same "), o(4, 1, "Other")];
    expect(outlineKeys("ch-1", outline)).toEqual([
      "ch-1#1:same:0",
      "ch-1#2:same:0",
      "ch-1#1:same:1",
      "ch-1#1:other:0",
    ]);
    // an unrelated heading inserted before keeps the other keys
    expect(outlineKeys("ch-1", [o(0, 1, "New"), ...outline]).slice(1)).toEqual(
      outlineKeys("ch-1", outline),
    );
    expect(outlineKeys("ch-1", [])).toEqual([]);
  });
});

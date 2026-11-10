import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kinded } from "./kinded";
import {
  CURRENT_FORMAT_VERSION,
  FormatError,
  addBackMatter,
  addChapter,
  addFrontMatter,
  createManifest,
  entryRows,
  entryRowsIn,
  parseManifest,
  serializeManifest,
  setMatterStartOnNext,
} from "../index";

const book = () => {
  let m = createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });
  m = addChapter(m, "One").manifest;
  m = addFrontMatter(m, "dedication", "For you").manifest;
  m = addFrontMatter(m, "epigraph", "The sea").manifest;
  return addBackMatter(m, "colophon", "Colophon").manifest;
};
const ids = (m: ReturnType<typeof book>) => ({
  dedication: m.frontMatter.find((e) => e.kind === "dedication")!.id,
  epigraph: m.frontMatter.find((e) => e.kind === "epigraph")!.id,
  colophon: m.backMatter[0]!.id,
  chapter: m.chapters[0]!.id,
});
const reopen = (raw: unknown) => parseManifest(JSON.stringify(raw)).manifest;

describe("setMatterStartOnNext", () => {
  it("sets and clears a front matter page's choice, leaving the page under the rules again", () => {
    const { dedication } = ids(book());
    let m = setMatterStartOnNext(book(), dedication, true);
    expect(m.frontMatter.find((e) => e.id === dedication)!.startOnNext).toBe(true);
    m = setMatterStartOnNext(m, dedication, null);
    expect("startOnNext" in m.frontMatter.find((e) => e.id === dedication)!).toBe(false);
  });

  it("works on back matter and leaves the other pages alone", () => {
    const m0 = book();
    const { colophon, dedication } = ids(m0);
    const m = setMatterStartOnNext(m0, colophon, true);
    expect(m.backMatter[0]!.startOnNext).toBe(true);
    expect(m.frontMatter.find((e) => e.id === dedication)!.startOnNext).toBeUndefined();
  });

  it("refuses a chapter and an unknown page", () => {
    const m = book();
    const i = ids(m);
    expect(() => setMatterStartOnNext(m, i.chapter, true)).toThrow(/no front or back matter/);
    expect(() => setMatterStartOnNext(m, "nope", true)).toThrow(/no front or back matter/);
  });
});

describe("startOnNext in the manifest", () => {
  it("survives a save and a load", () => {
    const m0 = book();
    const m = setMatterStartOnNext(
      setMatterStartOnNext(m0, ids(m0).epigraph, true),
      ids(m0).colophon,
      true,
    );
    const back = reopen(JSON.parse(serializeManifest(m)));
    expect(back.frontMatter.find((e) => e.kind === "epigraph")!.startOnNext).toBe(true);
    expect(back.backMatter[0]!.startOnNext).toBe(true);
    expect(back.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it("refuses a value that is not true or false", () => {
    const m = book();
    const dedication = m.frontMatter.find((e) => e.kind === "dedication")!;
    expect(() => reopen({ ...m, frontMatter: [{ ...dedication, startOnNext: "yes" }] })).toThrow(
      /startOnNext" must be true or false/,
    );
  });

  it("belongs on a front or back matter page, never on a chapter", () => {
    const m = book();
    expect(() => reopen({ ...m, chapters: [{ ...m.chapters[0]!, startOnNext: true }] })).toThrow(
      FormatError,
    );
    expect(() => reopen({ ...m, chapters: [{ ...m.chapters[0]!, startOnNext: true }] })).toThrow(
      /belongs on a front or back matter page/,
    );
  });

  it("is carried by both kinds of list row", () => {
    const m0 = book();
    const m = setMatterStartOnNext(m0, ids(m0).dedication, true);
    const row = entryRows(m.frontMatter, m.editions).find((r) => r.id === ids(m0).dedication)!;
    expect(row.startOnNext).toBe(true);
    const inRow = entryRowsIn(m.frontMatter, m.editions, "en").find(
      (r) => r.id === ids(m0).dedication,
    )!;
    expect(inRow.startOnNext).toBe(true);
    expect(entryRows(m0.frontMatter, m0.editions)[0]).not.toHaveProperty("startOnNext");
    expect(entryRowsIn(m0.frontMatter, m0.editions, "en")[0]).not.toHaveProperty("startOnNext");
  });
});

describe("migration v9 -> v10", () => {
  const json = readFileSync(
    new URL("../../../../fixtures/contract/manifest-v9.json", import.meta.url),
    "utf8",
  );
  it("opens a v9 book, changes only the version and loses nothing", () => {
    const r = parseManifest(json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(9);
    expect(CURRENT_FORMAT_VERSION).toBe(14);
    expect(r.manifest.frontMatter.some((e) => e.startOnNext !== undefined)).toBe(false);
    // What v9 added is still there.
    expect(r.manifest.frontMatter.find((e) => e.kind === "dedication")!.verticalCenter).toBe(true);
    const expected = JSON.parse(json);
    for (const e of expected.frontMatter) if (e.toc) e.toc.parts = true;
    expect(JSON.parse(serializeManifest(r.manifest))).toEqual({
      ...kinded(expected),
      formatVersion: 14,
    });
  });
});

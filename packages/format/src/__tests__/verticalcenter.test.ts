import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kinded } from "./kinded";
import {
  FormatError,
  addBackMatter,
  addChapter,
  addFrontMatter,
  createManifest,
  entryRows,
  entryRowsIn,
  parseManifest,
  serializeManifest,
  setMatterVerticalCenter,
} from "../index";

const book = () => {
  let m = createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });
  m = addChapter(m, "One").manifest;
  m = addFrontMatter(m, "dedication", "For you").manifest;
  m = addFrontMatter(m, "contents", "Contents").manifest;
  m = addFrontMatter(m, "copyright", "Copyright").manifest;
  return addBackMatter(m, "about-the-author", "About").manifest;
};
const ids = (m: ReturnType<typeof book>) => ({
  dedication: m.frontMatter.find((e) => e.kind === "dedication")!.id,
  contents: m.frontMatter.find((e) => e.kind === "contents")!.id,
  copyright: m.frontMatter.find((e) => e.kind === "copyright")!.id,
  about: m.backMatter[0]!.id,
  chapter: m.chapters[0]!.id,
});
const reopen = (raw: unknown) => parseManifest(JSON.stringify(raw)).manifest;

describe("setMatterVerticalCenter", () => {
  it("sets, replaces and clears a front matter page's own choice", () => {
    const { dedication } = ids(book());
    let m = setMatterVerticalCenter(book(), dedication, false);
    expect(m.frontMatter.find((e) => e.id === dedication)!.verticalCenter).toBe(false);
    m = setMatterVerticalCenter(m, dedication, true);
    expect(m.frontMatter.find((e) => e.id === dedication)!.verticalCenter).toBe(true);
    m = setMatterVerticalCenter(m, dedication, null);
    expect("verticalCenter" in m.frontMatter.find((e) => e.id === dedication)!).toBe(false);
  });

  it("works on back matter and leaves the other pages alone", () => {
    const m0 = book();
    const { about, dedication } = ids(m0);
    const m = setMatterVerticalCenter(m0, about, true);
    expect(m.backMatter[0]!.verticalCenter).toBe(true);
    expect(m.frontMatter.find((e) => e.id === dedication)!.verticalCenter).toBeUndefined();
  });

  it("refuses a chapter, an unknown page, and the contents and copyright pages", () => {
    const m = book();
    const i = ids(m);
    expect(() => setMatterVerticalCenter(m, i.chapter, true)).toThrow(/no front or back matter/);
    expect(() => setMatterVerticalCenter(m, "nope", true)).toThrow(/no front or back matter/);
    expect(() => setMatterVerticalCenter(m, i.contents, true)).toThrow(/never centred/);
    expect(() => setMatterVerticalCenter(m, i.copyright, true)).toThrow(/never centred/);
  });
});

describe("verticalCenter in the manifest", () => {
  it("survives a save and a load", () => {
    const m0 = book();
    const m = setMatterVerticalCenter(
      setMatterVerticalCenter(m0, ids(m0).dedication, false),
      ids(m0).about,
      true,
    );
    const back = reopen(JSON.parse(serializeManifest(m)));
    expect(back.frontMatter.find((e) => e.kind === "dedication")!.verticalCenter).toBe(false);
    expect(back.backMatter[0]!.verticalCenter).toBe(true);
    expect(back.formatVersion).toBe(15);
  });

  it("refuses a value that is not true or false", () => {
    const m = book();
    const dedication = m.frontMatter.find((e) => e.kind === "dedication")!;
    expect(() => reopen({ ...m, frontMatter: [{ ...dedication, verticalCenter: "yes" }] })).toThrow(
      /verticalCenter" must be true or false/,
    );
  });

  it("refuses the setting on a chapter, a contents page and a copyright page", () => {
    const m = book();
    const entry = (kind: string) => m.frontMatter.find((e) => e.kind === kind)!;
    expect(() => reopen({ ...m, chapters: [{ ...m.chapters[0]!, verticalCenter: true }] })).toThrow(
      FormatError,
    );
    for (const kind of ["contents", "copyright"])
      expect(() =>
        reopen({ ...m, frontMatter: [{ ...entry(kind), verticalCenter: true }] }),
      ).toThrow(/belongs on a front or back matter page other than/);
  });

  it("is carried by both kinds of list row", () => {
    const m0 = book();
    const m = setMatterVerticalCenter(m0, ids(m0).dedication, true);
    const row = entryRows(m.frontMatter, m.editions).find((r) => r.id === ids(m0).dedication)!;
    expect(row.verticalCenter).toBe(true);
    expect(row.kind).toBe("dedication");
    const inRow = entryRowsIn(m.frontMatter, m.editions, "en").find(
      (r) => r.id === ids(m0).dedication,
    )!;
    expect(inRow.verticalCenter).toBe(true);
    expect(inRow.kind).toBe("dedication");
    expect(entryRows(m0.frontMatter, m0.editions)[0]).not.toHaveProperty("verticalCenter");
    expect(entryRowsIn(m0.frontMatter, m0.editions, "en")[0]).not.toHaveProperty("verticalCenter");
  });
});

describe("migration v8 -> current", () => {
  const json = readFileSync(
    new URL("../../../../fixtures/contract/manifest-v8.json", import.meta.url),
    "utf8",
  );
  it("opens a v8 book, changes only the version and loses nothing", () => {
    const r = parseManifest(json);
    expect(r.migrated).toBe(true);
    expect(r.fromVersion).toBe(8);
    expect(r.manifest.dropCap).toBe(true);
    expect(r.manifest.chapters[0]).toMatchObject({ dropCap: false, icon: "feather" });
    expect(r.manifest.frontMatter.some((e) => e.verticalCenter !== undefined)).toBe(false);
    const expected = JSON.parse(json);
    for (const e of expected.frontMatter) if (e.toc) e.toc.parts = true;
    expect(JSON.parse(serializeManifest(r.manifest))).toEqual({
      ...kinded(expected),
      formatVersion: 15,
    });
  });
});

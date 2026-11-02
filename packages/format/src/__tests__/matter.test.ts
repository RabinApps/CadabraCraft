import { describe, expect, it } from "vitest";
import {
  addBackMatter,
  addChapter,
  addFrontMatter,
  canAddMatter,
  createManifest,
  moveChapter,
  moveMatter,
  readingOrder,
  removeChapter,
  removeMatter,
  renameChapter,
  renameMatter,
  sectionOf,
  validateManifest,
  FormatError,
} from "../index";

const empty = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });
const book = () => addChapter(empty(), "One").manifest;
const ids = (list: { id: string }[]) => list.map((e) => e.id);

describe("front matter edits", () => {
  it("adds pages with kind, unique ids and front-matter/NN-slug.json files", () => {
    let m = book();
    m = addFrontMatter(m, "dedication", "Dedication").manifest;
    m = addFrontMatter(m, "foreword", "Foreword").manifest;
    const r = addFrontMatter(m, "custom", "A Note: to Readers!");
    expect(r.entry).toMatchObject({
      kind: "custom",
      titles: { en: "A Note: to Readers!" },
      files: { en: "front-matter/03-a-note-to-readers.json" },
    });
    expect(m.frontMatter.map((e) => e.files.en)).toEqual([
      "front-matter/01-dedication.json",
      "front-matter/02-foreword.json",
    ]);
    expect(new Set(readingOrder(r.manifest).map((e) => e.id)).size).toBe(4);
    expect(() => validateManifest(r.manifest)).not.toThrow();
  });
  it("places pages in conventional order but keeps customs at the end", () => {
    let m = book();
    for (const k of [
      "preface",
      "custom",
      "dedication",
      "copyright",
      "title-page",
      "foreword",
    ] as const)
      m = addFrontMatter(m, k, k).manifest;
    expect(m.frontMatter.map((e) => e.kind)).toEqual([
      "title-page",
      "copyright",
      "dedication",
      "foreword",
      "preface",
      "custom",
    ]);
  });
  it("allows at most one title page and one copyright page", () => {
    const m = addFrontMatter(
      addFrontMatter(book(), "title-page", "Title").manifest,
      "copyright",
      "Copyright",
    ).manifest;
    expect(canAddMatter(m, "title-page")).toBe(false);
    expect(canAddMatter(m, "copyright")).toBe(false);
    expect(canAddMatter(m, "dedication")).toBe(true);
    expect(() => addFrontMatter(m, "title-page", "Again")).toThrow(/title-page/);
    expect(() => addFrontMatter(m, "copyright", "Again")).toThrow(/copyright/);
    // multiples of the other kinds are fine
    expect(() =>
      addFrontMatter(addFrontMatter(m, "dedication", "D1").manifest, "dedication", "D2"),
    ).not.toThrow();
  });
  it("frees the slot again after removal", () => {
    const { manifest, entry } = addFrontMatter(book(), "title-page", "Title");
    const { manifest: next } = removeMatter(manifest, entry.id);
    expect(canAddMatter(next, "title-page")).toBe(true);
  });
  it("rejects back-matter kinds in the front and vice versa", () => {
    expect(() => addFrontMatter(book(), "colophon" as never, "x")).toThrow(/front matter/);
    expect(() => addBackMatter(book(), "dedication" as never, "x")).toThrow(/back matter/);
    expect(canAddMatter(book(), "colophon")).toBe(true);
  });
  it("never reuses an id or file after a removal", () => {
    let m = addFrontMatter(book(), "dedication", "Dedication").manifest;
    m = addFrontMatter(m, "foreword", "Foreword").manifest;
    m = removeMatter(m, "fm-1").manifest;
    const r = addFrontMatter(m, "preface", "Preface");
    expect(ids(r.manifest.frontMatter)).toHaveLength(2);
    expect(new Set(r.manifest.frontMatter.map((e) => e.files.en)).size).toBe(2);
    expect(r.entry.id).not.toBe("fm-2");
    expect(() => validateManifest(r.manifest)).not.toThrow();
  });
});

describe("back matter edits", () => {
  it("adds pages under back-matter/ with bm- ids, appended in order", () => {
    let m = book();
    m = addBackMatter(m, "acknowledgments", "Acknowledgments").manifest;
    const r = addBackMatter(m, "about-the-author", "About the Author");
    expect(r.manifest.backMatter.map((e) => [e.id, e.files.en, e.kind])).toEqual([
      ["bm-1", "back-matter/01-acknowledgments.json", "acknowledgments"],
      ["bm-2", "back-matter/02-about-the-author.json", "about-the-author"],
    ]);
  });
  it("can have several customs and also-by pages", () => {
    let m = book();
    for (let i = 0; i < 3; i++) m = addBackMatter(m, "custom", "Appendix").manifest;
    expect(m.backMatter).toHaveLength(3);
    expect(new Set(m.backMatter.map((e) => e.files.en)).size).toBe(3);
  });
});

describe("rename, move and remove matter", () => {
  const full = () => {
    let m = book();
    for (const k of ["dedication", "foreword", "preface"] as const)
      m = addFrontMatter(m, k, k).manifest;
    for (const k of ["acknowledgments", "colophon"] as const) m = addBackMatter(m, k, k).manifest;
    return m;
  };
  it("finds the section of an id", () => {
    const m = full();
    expect(sectionOf(m, "fm-1")).toBe("front");
    expect(sectionOf(m, "ch-1")).toBe("chapter");
    expect(sectionOf(m, "bm-2")).toBe("back");
    expect(sectionOf(m, "nope")).toBeNull();
  });
  it("renames the title only, keeping file and kind", () => {
    const m = renameMatter(full(), "fm-2", "Foreword by Someone");
    expect(m.frontMatter[1]).toEqual({
      id: "fm-2",
      files: { en: "front-matter/02-foreword.json" },
      titles: { en: "Foreword by Someone" },
      kind: "foreword",
    });
  });
  it("moves within its own section only and clamps", () => {
    expect(ids(moveMatter(full(), "fm-3", -1).frontMatter)).toEqual(["fm-1", "fm-3", "fm-2"]);
    expect(ids(moveMatter(full(), "fm-1", 99).frontMatter)).toEqual(["fm-2", "fm-3", "fm-1"]);
    expect(ids(moveMatter(full(), "bm-1", -5).backMatter)).toEqual(["bm-1", "bm-2"]);
    const moved = moveMatter(full(), "bm-2", -1);
    expect(ids(moved.backMatter)).toEqual(["bm-2", "bm-1"]);
    expect(ids(moved.frontMatter)).toEqual(["fm-1", "fm-2", "fm-3"]);
    expect(ids(moved.chapters)).toEqual(["ch-1"]);
  });
  it("removes and returns the entry; does not mutate its input", () => {
    const m = full();
    const r = removeMatter(m, "fm-2");
    expect(r.removed.titles.en).toBe("foreword");
    expect(ids(r.manifest.frontMatter)).toEqual(["fm-1", "fm-3"]);
    expect(ids(m.frontMatter)).toEqual(["fm-1", "fm-2", "fm-3"]);
  });
  it("rejects chapter ids and unknown ids", () => {
    const m = full();
    expect(() => renameMatter(m, "ch-1", "x")).toThrow(/no front or back matter/);
    expect(() => moveMatter(m, "nope", 1)).toThrow();
    expect(() => removeMatter(m, "ch-1")).toThrow();
  });
  it("leaves chapter operations unchanged", () => {
    let m = addChapter(full(), "Two").manifest;
    m = moveChapter(m, "ch-2", -1);
    expect(ids(m.chapters)).toEqual(["ch-2", "ch-1"]);
    m = renameChapter(m, "ch-1", "First");
    m = removeChapter(m, "ch-2").manifest;
    expect(m.chapters).toEqual([
      { id: "ch-1", files: { en: "manuscript/001-one.json" }, titles: { en: "First" } },
    ]);
    expect(() => renameChapter(m, "fm-1", "x")).toThrow();
    expect(() => validateManifest(m)).not.toThrow();
  });
  it("chapter ids never collide with matter ids", () => {
    const m = full();
    const r = addChapter(m, "Two");
    expect(readingOrder(r.manifest).map((e) => e.id)).toEqual([
      "fm-1",
      "fm-2",
      "fm-3",
      "ch-1",
      "ch-2",
      "bm-1",
      "bm-2",
    ]);
  });
});

it("FormatError is exported for kind validation", () => {
  expect(new FormatError("x")).toBeInstanceOf(Error);
});

describe("contents page", () => {
  it("is a single-use front matter kind placed after the epigraph and before the foreword", () => {
    let m = book();
    for (const k of ["foreword", "epigraph", "contents", "dedication"] as const)
      m = addFrontMatter(m, k, k).manifest;
    expect(m.frontMatter.map((e) => e.kind)).toEqual([
      "dedication",
      "epigraph",
      "contents",
      "foreword",
    ]);
    expect(canAddMatter(m, "contents")).toBe(false);
    expect(() => addFrontMatter(m, "contents", "Again")).toThrow(/contents/);
    expect(canAddMatter(book(), "contents")).toBe(true);
  });
  it("cannot go in the back matter and frees the slot after removal", () => {
    expect(() => addBackMatter(book(), "contents" as never, "x")).toThrow(/back matter/);
    const { manifest, entry } = addFrontMatter(book(), "contents", "Contents");
    expect(canAddMatter(removeMatter(manifest, entry.id).manifest, "contents")).toBe(true);
  });
});

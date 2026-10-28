import { describe, expect, it } from "vitest";
import {
  addChapter,
  restoreEntry,
  createManifest,
  moveChapter,
  removeChapter,
  renameChapter,
  retargetFile,
  sameTree,
  treeOf,
  validateManifest,
  withTree,
} from "../index";

describe("history snapshots", () => {
  const base = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });
  it("restores only the tree, keeping other manifest fields", () => {
    const one = addChapter(base(), "One").manifest;
    const before = treeOf(one);
    const two = addChapter(one, "Two").manifest;
    const back = withTree({ ...two, template: "modern" }, before);
    expect(back.chapters.map((c) => c.titles.en)).toEqual(["One"]);
    expect(back.template).toBe("modern");
    expect(sameTree(treeOf(back), before)).toBe(true);
    expect(sameTree(treeOf(two), before)).toBe(false);
  });
  it("retargets the entry for a file that came back under another name, without mutating", () => {
    const m = addChapter(base(), "One").manifest;
    const file = m.chapters[0]!.files.en!;
    const t = retargetFile(treeOf(m), "en", file, "manuscript/x-2.json");
    expect(t.chapters[0]!.files.en).toBe("manuscript/x-2.json");
    expect(m.chapters[0]!.files.en).toBe(file);
  });
});

const empty = () => createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });
const three = () => {
  let m = empty();
  for (const t of ["One", "Two", "Three"]) m = addChapter(m, t).manifest;
  return m;
};
const ids = (m: ReturnType<typeof three>) => m.chapters.map((c) => c.id);

describe("chapter tree edits", () => {
  it("adds chapters with unique ids and files, staying valid", () => {
    const m = three();
    expect(ids(m)).toEqual(["ch-1", "ch-2", "ch-3"]);
    expect(m.chapters[1]!.files.en).toBe("manuscript/002-two.json");
    expect(() => validateManifest(m)).not.toThrow();
  });
  it("never reuses an id or file after a removal", () => {
    let m = three();
    m = removeChapter(m, "ch-1").manifest;
    const { manifest, entry } = addChapter(m, "Four");
    expect(entry.id).not.toBe("ch-2");
    expect(new Set(manifest.chapters.map((c) => c.files.en)).size).toBe(manifest.chapters.length);
    expect(() => validateManifest(manifest)).not.toThrow();
  });
  it("renames the title only", () => {
    const m = renameChapter(three(), "ch-2", "Second");
    expect(m.chapters[1]).toEqual({
      id: "ch-2",
      files: { en: "manuscript/002-two.json" },
      titles: { en: "Second" },
    });
  });
  it("moves and clamps", () => {
    expect(ids(moveChapter(three(), "ch-3", -1))).toEqual(["ch-1", "ch-3", "ch-2"]);
    expect(ids(moveChapter(three(), "ch-1", 99))).toEqual(["ch-2", "ch-3", "ch-1"]);
    expect(ids(moveChapter(three(), "ch-1", -5))).toEqual(["ch-1", "ch-2", "ch-3"]);
  });
  it("does not mutate its input and rejects unknown ids", () => {
    const m = three();
    moveChapter(m, "ch-3", -2);
    expect(ids(m)).toEqual(["ch-1", "ch-2", "ch-3"]);
    expect(() => renameChapter(m, "nope", "x")).toThrow();
    expect(() => removeChapter(m, "nope")).toThrow();
  });
});

describe("restoreEntry", () => {
  it("appends to the section the folder names, with a fresh id", () => {
    const m = three();
    const c = restoreEntry(m, "manuscript/009-old.json", "Old");
    expect(c.manifest.chapters.map((e) => e.id)).toEqual(["ch-1", "ch-2", "ch-3", "ch-4"]);
    const b = restoreEntry(m, "back-matter/01-colophon.json", "Colophon");
    expect(b.manifest.backMatter).toEqual([
      {
        id: "bm-1",
        files: { en: "back-matter/01-colophon.json" },
        titles: { en: "Colophon" },
        kind: "custom",
      },
    ]);
    expect(validateManifest(JSON.parse(JSON.stringify(b.manifest)))).toBeTruthy();
  });
  it("refuses a file already in the book or outside the page folders", () => {
    const m = three();
    expect(() => restoreEntry(m, m.chapters[0]!.files.en!, "x")).toThrow();
    expect(() => restoreEntry(m, "assets/a.json", "x")).toThrow();
  });
});

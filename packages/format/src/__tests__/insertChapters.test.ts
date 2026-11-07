import { describe, expect, it } from "vitest";
import {
  addChapter,
  addPart,
  createManifest,
  insertChaptersAt,
  sourceFile,
  type Manifest,
} from "../index";

function book(): Manifest {
  let m = createManifest({ title: "T", author: "A", identifier: "urn:uuid:x" });
  m = addChapter(m, "One").manifest;
  m = addPart(m, "Part", "ch-1").manifest;
  m = addChapter(m, "Two").manifest;
  return m;
}
const names = (m: Manifest) => m.chapters.map((e) => `${e.kind ?? "chapter"}:${e.titles.en}`);

describe("insertChaptersAt", () => {
  it("inserts in the middle, in order, with free ids and file names", () => {
    const m = book();
    const r = insertChaptersAt(m, ["A", "B"], 1);
    expect(names(r.manifest)).toEqual([
      "chapter:One",
      "chapter:A",
      "chapter:B",
      "part:Part",
      "chapter:Two",
    ]);
    expect(r.entries.map((e) => e.titles.en)).toEqual(["A", "B"]);
    const files = r.manifest.chapters.map((e) => sourceFile(e, r.manifest.editions));
    expect(new Set(files).size).toBe(files.length);
    expect(new Set(r.manifest.chapters.map((e) => e.id)).size).toBe(5);
  });
  it("after a part divider the chapters join that part", () => {
    const r = insertChaptersAt(book(), ["A"], 2);
    expect(names(r.manifest)).toEqual(["chapter:One", "part:Part", "chapter:A", "chapter:Two"]);
  });
  it("clamps the index and does not change the input", () => {
    const m = book();
    const copy = JSON.stringify(m);
    expect(names(insertChaptersAt(m, ["E"], 99).manifest).at(-1)).toBe("chapter:E");
    expect(names(insertChaptersAt(m, ["S"], -4).manifest)[0]).toBe("chapter:S");
    expect(JSON.stringify(m)).toBe(copy);
  });
});

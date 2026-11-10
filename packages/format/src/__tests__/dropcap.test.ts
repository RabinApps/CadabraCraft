import { describe, expect, it } from "vitest";
import {
  FormatError,
  addChapter,
  addFrontMatter,
  createManifest,
  parseManifest,
  serializeManifest,
  setChapterDropCap,
} from "../index";

const book = () => {
  const base = createManifest({ title: "T", author: "A", identifier: "urn:uuid:1" });
  return addFrontMatter(addChapter(base, "One").manifest, "dedication", "For you").manifest;
};
const reopen = (raw: unknown) => parseManifest(JSON.stringify(raw)).manifest;

describe("drop cap settings", () => {
  it("sets, replaces and clears a chapter's own choice", () => {
    let m = setChapterDropCap(book(), "ch-1", true);
    expect(m.chapters[0]!.dropCap).toBe(true);
    m = setChapterDropCap(m, "ch-1", false);
    expect(m.chapters[0]!.dropCap).toBe(false);
    m = setChapterDropCap(m, "ch-1", null);
    expect("dropCap" in m.chapters[0]!).toBe(false);
  });
  it("leaves other chapters alone and refuses a page that is not a chapter", () => {
    const two = addChapter(book(), "Two").manifest;
    const m = setChapterDropCap(two, "ch-2", true);
    expect(m.chapters[0]!.dropCap).toBeUndefined();
    expect(() => setChapterDropCap(book(), "fm-1", true)).toThrow("no chapter fm-1");
  });
  it("survives a save and a load, on the book and on a chapter", () => {
    const m = { ...setChapterDropCap(book(), "ch-1", false), dropCap: true };
    const back = reopen(JSON.parse(serializeManifest(m)));
    expect(back.dropCap).toBe(true);
    expect(back.chapters[0]!.dropCap).toBe(false);
    expect(back.formatVersion).toBe(14);
  });
  it("refuses a value that is not true or false, and a chapter setting on matter", () => {
    const m = book();
    expect(() => reopen({ ...m, dropCap: "yes" })).toThrow(FormatError);
    expect(() => reopen({ ...m, chapters: [{ ...m.chapters[0]!, dropCap: 1 }] })).toThrow(
      /dropCap" must be true or false/,
    );
    expect(() => reopen({ ...m, frontMatter: [{ ...m.frontMatter[0]!, dropCap: true }] })).toThrow(
      /belongs on a chapter only/,
    );
  });
});

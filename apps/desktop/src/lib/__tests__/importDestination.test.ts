import { addChapter, addPartBefore, createManifest } from "@cadabracraft/format";
import { describe, expect, it } from "vitest";
import { destinationOptions, insertIndexAfter, previewChoices } from "../import/importDestination";

const base = () =>
  createManifest({ title: "Book", author: "Me", language: "en", identifier: "urn:uuid:x" });
/** Chapter One, Part B (a divider), Two. */
const book = () => {
  let m = addChapter(base(), "Chapter One").manifest;
  m = addChapter(m, "Two").manifest;
  return addPartBefore(m, "Part B", "ch-2").manifest;
};

describe("destinationOptions", () => {
  it("lists every entry of the chapters list, marking part dividers", () => {
    expect(destinationOptions(book())).toEqual([
      { id: "ch-1", title: "Chapter One", part: false },
      { id: "pt-1", title: "Part B", part: true },
      { id: "ch-2", title: "Two", part: false },
    ]);
  });
  it("has nothing for a book with no chapters", () => {
    expect(destinationOptions(base())).toEqual([]);
  });
});

describe("insertIndexAfter", () => {
  const m = book();
  it("puts the chapters right behind the chosen entry", () => {
    expect(insertIndexAfter(m, "ch-1")).toBe(1);
    expect(insertIndexAfter(m, "pt-1")).toBe(2); // right after the divider: inside the part
    expect(insertIndexAfter(m, "ch-2")).toBe(3);
  });
  it("means the end for no choice or an entry that is gone", () => {
    expect(insertIndexAfter(m, null)).toBe(3);
    expect(insertIndexAfter(m, "ch-9")).toBe(3);
  });
});

describe("previewChoices", () => {
  const preview = { level: 2 as const, plan: [], outline: false };
  it("is nothing without a preview", () => {
    expect(previewChoices(null, book(), "ch-1")).toBeUndefined();
  });
  it("carries the level, plan and kind, and a position only when adding to an open book", () => {
    expect(previewChoices(preview, null, null)).toEqual({
      splitHeadingLevel: 2,
      plan: [],
      outline: false,
    });
    expect(previewChoices(preview, book(), "ch-1")).toMatchObject({ insertAt: 1 });
    expect(previewChoices(preview, book(), null)).toMatchObject({ insertAt: 3 });
  });
});

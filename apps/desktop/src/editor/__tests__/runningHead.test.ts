import { describe, expect, it } from "vitest";
import { matterHeadsOn } from "../centring";
import { runningHead } from "../pagination/frame";

describe("matterHeadsOn", () => {
  it("heads the pages a front or back matter page runs onto", () => {
    expect(matterHeadsOn(false, "front", "foreword")).toBe(true);
    expect(matterHeadsOn(false, "front", "preface")).toBe(true);
    expect(matterHeadsOn(false, "back", "acknowledgments")).toBe(true);
    // A custom page has no kind.
    expect(matterHeadsOn(false, "back", undefined)).toBe(true);
  });

  it("heads no page of a layout the PDF lays out without one", () => {
    // `folio-off` pages: the title page and the copyright page behind it, and the contents.
    expect(matterHeadsOn(false, "front", "title-page")).toBe(false);
    expect(matterHeadsOn(false, "front", "copyright")).toBe(false);
    expect(matterHeadsOn(false, "front", "contents")).toBe(false);
    // `header-off`: the template or the author centres the page (dedication, epigraph, or any centred page).
    expect(matterHeadsOn(true, "front", "dedication")).toBe(false);
    expect(matterHeadsOn(true, "back", "colophon")).toBe(false);
  });

  it("never speaks for a chapter, which heads its pages by its own rule", () => {
    expect(matterHeadsOn(false, "chapter", undefined)).toBe(false);
    expect(matterHeadsOn(false, "chapter", "foreword")).toBe(false);
  });
});

describe("runningHead", () => {
  it("prints the entry's title on a right-hand page and the book title on a left-hand one", () => {
    expect(runningHead("body", 3, "E2E Book", "Foreword", true)).toBe("Foreword"); // recto
    expect(runningHead("body", 4, "E2E Book", "Foreword", true)).toBe("E2E Book"); // verso
    // A matter page heads the pages after its own, with its own title (the PDF's chapter-title state).
    expect(runningHead("body", 7, "E2E Book", "A Long Foreword", true)).toBe("A Long Foreword");
  });

  it("prints nothing on a chapter opening, a blank page or an entry without heads", () => {
    expect(runningHead("open", 1, "E2E Book", "Chapter One", true)).toBeNull();
    expect(runningHead("blank", 2, "E2E Book", "Chapter One", true)).toBeNull();
    // The page the entry opens on, whatever its kind: a matter page's first card asks for no head.
    expect(runningHead("body", 5, "E2E Book", "Foreword", false)).toBeNull();
  });
});

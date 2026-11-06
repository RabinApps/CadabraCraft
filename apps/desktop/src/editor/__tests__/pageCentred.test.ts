import { describe, expect, it } from "vitest";
import { getTemplate } from "@cadabracraft/templates";
import { centredPage, pageIsBare, pageIsCentred, pageIsCopyright, pageIsNarrow } from "../centring";
import { centreOffsetPx } from "../../lib/page/pageLayout";

const look = { print: getTemplate("novel").print };

describe("pageIsCentred", () => {
  it("centres the template's kinds, and a page the author chose either way", () => {
    expect(pageIsCentred(look, "front", "title-page", {})).toBe(true);
    expect(pageIsCentred(look, "front", "foreword", {})).toBe(false);
    expect(pageIsCentred(look, "front", "foreword", { verticalCenter: true })).toBe(true);
    expect(pageIsCentred(look, "front", "dedication", { verticalCenter: false })).toBe(false);
    expect(pageIsCentred(look, "back", "about-the-author", { verticalCenter: undefined })).toBe(
      false,
    );
  });
  it("treats a matter page with no kind as a custom page, and never centres a chapter", () => {
    expect(pageIsCentred(look, "front", undefined, {})).toBe(false);
    expect(pageIsCentred(look, "back", undefined, { verticalCenter: true })).toBe(true);
    expect(pageIsCentred(look, "chapter", undefined, { verticalCenter: true })).toBe(false);
  });
});

describe("centredPage", () => {
  it("centres a page of its own, not counting the blank verso the book puts before it", () => {
    expect(centredPage(true, ["body"])).toBe(true);
    expect(centredPage(true, ["blank", "body"])).toBe(true);
    expect(centredPage(true, ["open"])).toBe(true);
  });
  it("never centres a page that runs to more than one page, nor one the author did not centre", () => {
    expect(centredPage(true, ["body", "body"])).toBe(false);
    expect(centredPage(true, ["blank", "body", "body"])).toBe(false);
    expect(centredPage(false, ["body"])).toBe(false);
  });
});

describe("pageIsNarrow", () => {
  it("is the PDF's centred page for a centred matter page, never for a title page or a chapter", () => {
    expect(pageIsNarrow(true, "front", "dedication")).toBe(true);
    expect(pageIsNarrow(true, "front", "foreword")).toBe(true);
    expect(pageIsNarrow(true, "back", undefined)).toBe(true); // a custom page
    // A title page is a layout of its own in the PDF (`title-page`), full width.
    expect(pageIsNarrow(true, "front", "title-page")).toBe(false);
    // The block follows the page's choice, not the page count: a centred page that runs on keeps it.
    expect(pageIsNarrow(false, "front", "dedication")).toBe(false);
    expect(pageIsNarrow(true, "chapter", undefined)).toBe(false);
  });
});

describe("pageIsCopyright", () => {
  it("is the copyright page only, in the front or back matter", () => {
    expect(pageIsCopyright("front", "copyright")).toBe(true);
    expect(pageIsCopyright("front", "title-page")).toBe(false);
    expect(pageIsCopyright("front", undefined)).toBe(false);
    expect(pageIsCopyright("chapter", "copyright")).toBe(false);
  });
});

describe("pageIsBare", () => {
  it("is true for the PDF's own matter layouts and for any centred page, never for a chapter's opening", () => {
    expect(pageIsBare(false, "front", "title-page")).toBe(true);
    expect(pageIsBare(false, "front", "dedication")).toBe(true);
    expect(pageIsBare(false, "front", "epigraph")).toBe(true);
    expect(pageIsBare(true, "back", "about-the-author")).toBe(true);
    expect(pageIsBare(false, "front", "foreword")).toBe(false);
    expect(pageIsBare(false, "front", undefined)).toBe(false);
    expect(pageIsBare(false, "chapter", undefined)).toBe(false);
  });
});

describe("centreOffsetPx", () => {
  it("is half of the free height, rounded", () => {
    expect(centreOffsetPx(100, 500)).toBe(200);
    expect(centreOffsetPx(101, 500)).toBe(200);
    expect(centreOffsetPx(0, 500)).toBe(250);
  });
  it("is zero when the content fills or overflows the text box", () => {
    expect(centreOffsetPx(500, 500)).toBe(0);
    expect(centreOffsetPx(900, 500)).toBe(0);
  });
});

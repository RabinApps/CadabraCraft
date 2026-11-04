import { describe, expect, it } from "vitest";
import { typewriterSlack, typewriterTarget } from "../typewriterScroll";

const view = { top: 100, bottom: 700 }; // middle at 400
const line = (middle: number) => ({ top: middle - 10, bottom: middle + 10 });

describe("typewriterTarget", () => {
  it("scrolls down by the distance below the middle", () => {
    expect(typewriterTarget({ caret: line(600), view, scrollTop: 1000 })).toBe(1200);
  });
  it("scrolls up by the distance above the middle", () => {
    expect(typewriterTarget({ caret: line(250), view, scrollTop: 1000 })).toBe(850);
  });
  it("stays when the caret is in the middle or within the tolerance", () => {
    expect(typewriterTarget({ caret: line(400), view, scrollTop: 500 })).toBeNull();
    expect(typewriterTarget({ caret: line(402), view, scrollTop: 500 })).toBeNull();
    expect(typewriterTarget({ caret: line(403), view, scrollTop: 500 })).toBe(503);
    expect(typewriterTarget({ caret: line(405), view, scrollTop: 500, tolerance: 10 })).toBeNull();
  });
  it("cannot go above the top: the first lines stay where they are", () => {
    expect(typewriterTarget({ caret: line(150), view, scrollTop: 0 })).toBeNull();
    expect(typewriterTarget({ caret: line(150), view, scrollTop: 100 })).toBe(0);
  });
  it("cannot go past the end of the scroller", () => {
    expect(typewriterTarget({ caret: line(650), view, scrollTop: 900, maxScrollTop: 1000 })).toBe(
      1000,
    );
    expect(
      typewriterTarget({ caret: line(650), view, scrollTop: 1000, maxScrollTop: 1000 }),
    ).toBeNull();
  });
  it("copes with a negative maximum (content shorter than the view)", () => {
    expect(typewriterTarget({ caret: line(650), view, scrollTop: 0, maxScrollTop: -5 })).toBeNull();
  });
  it("ignores a sub-pixel move", () => {
    expect(typewriterTarget({ caret: line(400.5), view, scrollTop: 10, tolerance: 0 })).toBeNull();
  });
});

describe("typewriterSlack", () => {
  it("is half the height, rounded", () => {
    expect(typewriterSlack(601)).toBe(301);
    expect(typewriterSlack(0)).toBe(0);
    expect(typewriterSlack(-4)).toBe(0);
  });
});

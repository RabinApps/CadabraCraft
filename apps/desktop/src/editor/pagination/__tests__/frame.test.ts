import { describe, expect, it } from "vitest";
import { cssVarsStyle, pageFontStack, pickPageFont, runningHead } from "../frame";

describe("cssVarsStyle", () => {
  it("keeps custom properties and turns plain ones into page variables", () => {
    expect(cssVarsStyle({ "--page-w": "528px", "text-align": "justify", hyphens: "auto" })).toEqual(
      {
        "--page-w": "528px",
        "--page-text-align": "justify",
        "--page-hyphens": "auto",
      },
    );
  });
});

describe("pickPageFont", () => {
  it("takes the first template font that is available, ignoring case", () => {
    expect(pickPageFont(["Libertinus Serif", "Georgia"], ["Georgia", "libertinus serif"])).toBe(
      "libertinus serif",
    );
    expect(pickPageFont(["Inter", "Helvetica Neue"], ["Helvetica Neue"])).toBe("Helvetica Neue");
  });
  it("is null when none can be drawn", () => {
    expect(pickPageFont(["Libertinus Serif"], ["Lora"])).toBeNull();
    expect(pickPageFont([], ["Lora"])).toBeNull();
  });
});

describe("pageFontStack", () => {
  it("maps the bundled families to their tokens and quotes the others", () => {
    expect(pageFontStack("Inter")).toBe("var(--font-ui)");
    expect(pageFontStack("Newsreader")).toBe("var(--font-book)");
    expect(pageFontStack("Libertinus Serif")).toBe('"Libertinus Serif", var(--font-book)');
  });
});

describe("runningHead", () => {
  it("shows the book on left-hand pages and the chapter on right-hand ones", () => {
    expect(runningHead("body", 2, "Book", "Chapter", true)).toBe("Book");
    expect(runningHead("body", 3, "Book", "Chapter", true)).toBe("Chapter");
  });
  it("shows nothing on an opening, a blank page or outside a chapter", () => {
    expect(runningHead("open", 3, "Book", "Chapter", true)).toBeNull();
    expect(runningHead("blank", 2, "Book", "Chapter", true)).toBeNull();
    expect(runningHead("body", 3, "Book", "Chapter", false)).toBeNull();
  });
});

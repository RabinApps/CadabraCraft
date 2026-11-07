import { describe, expect, it } from "vitest";
import { currentSection, SPY_LINE } from "../reading/settingsScroll";

describe("currentSection", () => {
  it("is the first section at the top, before any heading has reached the line", () => {
    expect(currentSection([40, 182, 392], false)).toBe(0);
  });
  it("is the last section whose top has reached the line", () => {
    expect(currentSection([-300, -100, SPY_LINE, SPY_LINE + 1], false)).toBe(2);
  });
  it("is the first when every section is still below the line", () => {
    expect(currentSection([300, 600], false)).toBe(0);
  });
  it("is the last at the end of the page, even if it never reached the line", () => {
    expect(currentSection([-900, -400, 300], true)).toBe(2);
  });
  it("copes with no sections", () => {
    expect(currentSection([], true)).toBe(0);
  });
});

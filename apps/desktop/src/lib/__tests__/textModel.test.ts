import { describe, expect, it } from "vitest";
import { AVG_CHAR_EM, JUSTIFY_GAIN, avgCharEm, estimateLines } from "../page/textModel";

// 10 px font and 0.5 em per char: a 50 px line holds 10 characters.
const lines = (text: string, width = 50, indent = 0) => estimateLines(text, width, 10, 0.5, indent);

describe("estimateLines", () => {
  it("is 0 for empty or blank text", () => {
    expect(lines("")).toBe(0);
    expect(lines("  \n\t ")).toBe(0);
  });
  it("is 1 for text that fits", () => {
    expect(lines("hello")).toBe(1);
    expect(lines("1234567890")).toBe(1);
  });
  it("wraps greedily on word boundaries", () => {
    expect(lines("aaaa bbbb cccc")).toBe(2); // "aaaa bbbb" = 9, then "cccc"
    expect(lines("aaaa bbbb cccc dddd eeee")).toBe(3);
  });
  it("wraps a word that would overflow the line", () => {
    expect(lines("aaaaaa bbbbbb")).toBe(2);
  });
  it("splits a word longer than a line over several lines", () => {
    expect(lines("a".repeat(25))).toBe(3);
    expect(lines("hi " + "a".repeat(25))).toBeGreaterThanOrEqual(3);
  });
  it("shortens the first line with an indent", () => {
    expect(lines("aaaa bbbb", 50, 0)).toBe(1);
    expect(lines("aaaa bbbb", 50, 10)).toBe(2);
  });
  it("never divides by zero", () => {
    expect(estimateLines("a b", 0, 10, 0.5)).toBeGreaterThan(0);
    expect(estimateLines("a b", 100, 0, 0.5)).toBeGreaterThan(0);
  });
});

describe("avgCharEm", () => {
  it("is wider for sans than serif and narrower when justified", () => {
    expect(avgCharEm("sans", false)).toBe(AVG_CHAR_EM.sans);
    expect(avgCharEm("serif", false)).toBe(AVG_CHAR_EM.serif);
    expect(avgCharEm("serif", true)).toBeCloseTo(AVG_CHAR_EM.serif * JUSTIFY_GAIN);
    expect(AVG_CHAR_EM.sans).toBeGreaterThan(AVG_CHAR_EM.serif);
  });
});

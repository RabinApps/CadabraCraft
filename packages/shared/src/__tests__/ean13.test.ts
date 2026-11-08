import { describe, expect, it } from "vitest";
import { ean13CheckDigit, ean13Modules } from "../ean13";

const bits = (s: string) => [...s].map((c) => c === "1");

describe("ean13CheckDigit", () => {
  it("computes the GS1 check digit", () => {
    expect(ean13CheckDigit("978030640615")).toBe("7");
    expect(ean13CheckDigit("000000000000")).toBe("0");
    expect(ean13CheckDigit("999999999999")).toBe("4");
  });
  it("needs exactly twelve digits", () => {
    expect(() => ean13CheckDigit("12345")).toThrow("12 digits");
    expect(() => ean13CheckDigit("12345678901a")).toThrow("12 digits");
  });
});

describe("ean13Modules", () => {
  it("draws 95 modules with the start, centre and end guards", () => {
    const m = ean13Modules("9780306406157");
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toEqual(bits("101"));
    expect(m.slice(45, 50)).toEqual(bits("01010"));
    expect(m.slice(92)).toEqual(bits("101"));
  });
  it("uses the L and R codes of a zero number (first digit 0 is all L)", () => {
    const zeros = "0000000000000";
    const expected = [
      ...bits("101"),
      ...bits("0001101".repeat(6)),
      ...bits("01010"),
      ...bits("1110010".repeat(6)),
      ...bits("101"),
    ];
    expect(ean13Modules(zeros)).toEqual(expected);
  });
  it("picks the G code on the left for a first digit whose parity pattern says G", () => {
    // First digit 9 is LGGLGL: digits 1 and 2 are G, so digit 0 at position 0 uses L and digit 1 uses G.
    const m = ean13Modules("9999999999994");
    const leftFirstSix = m.slice(3, 45);
    expect(leftFirstSix.slice(0, 7)).toEqual(bits("0001011"));
    expect(leftFirstSix.slice(7, 14)).toEqual(bits("0010111"));
  });
  it("throws on a wrong check digit, wrong length or non-digits", () => {
    expect(() => ean13Modules("9780306406158")).toThrow("check digit");
    expect(() => ean13Modules("978030640615")).toThrow("13 digits");
    expect(() => ean13Modules("978030640615X")).toThrow("13 digits");
  });
});

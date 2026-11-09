import { describe, expect, it } from "vitest";
import { isbnBarcode } from "../typst/barcode";
import { PdfExportError } from "../errors";

/** ISBN 978-0-306-40615-7: 30 runs of bars (start guard 2, six L/G digits 12, centre guard 2, six R digits 12, end guard 2). */
const KNOWN = "978-0-306-40615-7";

describe("isbnBarcode", () => {
  it("draws nothing for an absent ISBN", () => {
    expect(isbnBarcode(undefined)).toBe("");
    expect(isbnBarcode(null)).toBe("");
    expect(isbnBarcode("")).toBe("");
    expect(isbnBarcode("   ")).toBe("");
  });

  it("draws one rectangle per run of bars for a known ISBN-13", () => {
    const src = isbnBarcode(KNOWN);
    expect(src.match(/rect\(/g)).toHaveLength(30);
  });

  it("draws the same bars for an ISBN-10 of the same book", () => {
    expect(isbnBarcode("0-306-40615-2")).toBe(isbnBarcode(KNOWN));
  });

  it("sizes the symbol to the standard 37.29 mm by 27.85 mm box", () => {
    const src = isbnBarcode(KNOWN);
    expect(src.startsWith("#box(width: 37.29mm, height: 27.85mm)[")).toBe(true);
  });

  it("extends only the guard bars below the main bars", () => {
    const src = isbnBarcode(KNOWN);
    const heights = [...src.matchAll(/height: ([\d.]+)mm, fill/g)].map((m) => m[1]);
    expect(new Set(heights)).toEqual(new Set(["22.85", "27.85"]));
    // The six guard bars (two each in the start, centre and end guards) run below the main bars.
    expect(heights.filter((h) => h === "27.85")).toHaveLength(6);
  });

  it("prints the thirteen digits under the bars", () => {
    const src = isbnBarcode(KNOWN);
    const printed = [...src.matchAll(/\[#text\(size: 8pt\)\[(\d)\]\]/g)].map((m) => m[1]);
    expect(printed.join("")).toBe("9780306406157");
    expect(src.match(/dy: 22.85mm/g)).toHaveLength(13);
  });

  it("throws a clear error for an invalid ISBN, so the export is refused", () => {
    for (const bad of ["978-0-306-40615-8", "12345", "ABC"]) {
      expect(() => isbnBarcode(bad)).toThrow(PdfExportError);
      expect(() => isbnBarcode(bad)).toThrow(/not a valid ISBN/);
    }
  });
});

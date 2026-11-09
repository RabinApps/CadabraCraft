import { PdfExportError } from "@cadabracraft/export-pdf";
import { describe, expect, it } from "vitest";
import { isbnToStored, isbnValid } from "../export/isbnForm";
import { describePdfError } from "../export/pdfErrors";

describe("ISBN field validation", () => {
  it("accepts an empty field and valid ISBN-10 and ISBN-13 values", () => {
    expect(isbnValid("")).toBe(true);
    expect(isbnValid("   ")).toBe(true);
    expect(isbnValid("978-3-16-148410-0")).toBe(true);
    expect(isbnValid("ISBN 0-306-40615-2")).toBe(true);
  });

  it("rejects a wrong check digit or stray characters", () => {
    expect(isbnValid("978-3-16-148410-1")).toBe(false);
    expect(isbnValid("12345")).toBe(false);
    expect(isbnValid("978-3-16-148410-X")).toBe(false);
  });

  it("stores the 13 digits with no hyphens, an ISBN-10 converted, and null when empty", () => {
    expect(isbnToStored("978-3-16-148410-0")).toBe("9783161484100");
    expect(isbnToStored("0-306-40615-2")).toBe("9780306406157");
    expect(isbnToStored("  ")).toBeNull();
  });

  it("throws rather than storing an invalid ISBN", () => {
    expect(() => isbnToStored("978-3-16-148410-1")).toThrow(/valid ISBN/);
  });
});

describe("describePdfError", () => {
  it("passes the exporter's ISBN message through as the author-facing text", () => {
    const err = new PdfExportError('The ISBN "1" is not a valid ISBN-10 or ISBN-13.');
    const ui = describePdfError(err);
    expect(ui.code).toBe("other");
    expect(ui.message).toBe('The ISBN "1" is not a valid ISBN-10 or ISBN-13.');
  });
});

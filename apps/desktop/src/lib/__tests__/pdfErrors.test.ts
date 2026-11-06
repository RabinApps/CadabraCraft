import { describe, expect, it } from "vitest";
import {
  FontNotAvailableError,
  MissingAssetError,
  TypstCompileError,
  TypstNotFoundError,
  TypstTimeoutError,
} from "@cadabracraft/export-pdf";
import { describePdfError, PdfUiError } from "../export/pdfErrors";

describe("describePdfError", () => {
  it("returns a PdfUiError unchanged", () => {
    const e = new PdfUiError("other", "x");
    expect(describePdfError(e)).toBe(e);
  });
  it("keeps the install advice when typst is missing", () => {
    const r = describePdfError(new TypstNotFoundError("", "install typst"));
    expect([r.code, r.message]).toEqual(["typst-missing", "install typst"]);
  });
  it("names the missing fonts", () => {
    const r = describePdfError(new FontNotAvailableError(["A", "B"], "body"));
    expect(r.code).toBe("font");
    expect(r.message).toContain('"A", "B"');
  });
  it("names one missing font in plain words and points at Settings, Fonts", () => {
    const r = describePdfError(new FontNotAvailableError(["Lora"], "body"));
    expect(r.message).toBe(
      "The font “Lora” is not on this computer. Download it in Settings, Fonts, or pick another font.",
    );
  });
  it("copes with a font error that names no family", () => {
    const r = describePdfError(new FontNotAvailableError([], "body"));
    expect(r.code).toBe("font");
  });
  it("shows the compiler output", () => {
    const r = describePdfError(new TypstCompileError(" oops \n"));
    expect(r.code).toBe("compile");
    expect(r.message).toMatch(/oops\nCheck the text/);
  });
  it("names the timeout, the missing images and anything else", () => {
    expect(describePdfError(new TypstTimeoutError(60))).toMatchObject({ code: "timeout" });
    expect(describePdfError(new TypstTimeoutError(60)).message).toContain("60 seconds");
    const a = describePdfError(new MissingAssetError(["a.png", "b.png"]));
    expect([a.code, a.message]).toEqual([
      "asset",
      "Missing image file a.png, b.png. Add the image again or remove it from the page, then export again.",
    ]);
    const o = describePdfError(new Error("weird"));
    expect([o.code, o.message]).toEqual(["other", "weird. Try again."]);
    expect(o.cause).toBeInstanceOf(Error);
  });
});

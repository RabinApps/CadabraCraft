import { describe, expect, it, vi } from "vitest";
import {
  PdfExportError,
  TypstCompileError,
  TypstNotFoundError,
  TypstTimeoutError,
} from "@cadabracraft/export-pdf";
import { createTauriRunner, mapTypstError } from "../typstRunner";

describe("mapTypstError", () => {
  it("maps each Rust error kind to an export-pdf error", () => {
    expect(mapTypstError({ kind: "not_found", message: "Install Typst" })).toBeInstanceOf(
      TypstNotFoundError,
    );
    expect(mapTypstError({ kind: "not_found", message: "Install Typst" }).message).toBe(
      "Install Typst",
    );
    expect(mapTypstError({ kind: "timeout", seconds: 120 })).toBeInstanceOf(TypstTimeoutError);
    expect(mapTypstError({ kind: "compile", message: "error: x" })).toBeInstanceOf(
      TypstCompileError,
    );
    expect(mapTypstError({ kind: "font", family: "Foo" }).message).toContain('"Foo"');
    expect(mapTypstError({ kind: "other", message: "disk full" })).toBeInstanceOf(PdfExportError);
    expect(mapTypstError("plain string").message).toBe("plain string");
  });
});

describe("createTauriRunner", () => {
  it("passes path, source, files and the PDF/A flag to the bridge", async () => {
    const typstCompile = vi.fn(async () => new Uint8Array([1]));
    const typstListFonts = vi.fn(async () => ["A"]);
    const r = createTauriRunner({ typstCompile, typstListFonts }, "  ");
    expect(await r.listFonts()).toEqual(["A"]);
    expect(typstListFonts).toHaveBeenCalledWith(null);
    await r.compile("src", new Map([["assets/x.png", new Uint8Array([5, 6])]]), { pdfA: true });
    expect(typstCompile).toHaveBeenCalledWith(
      null,
      "src",
      [["assets/x.png", new Uint8Array([5, 6])]],
      true,
    );
  });
  it("converts rejections", async () => {
    const r = createTauriRunner({
      typstCompile: async () => {
        throw { kind: "timeout", seconds: 1 };
      },
      typstListFonts: async () => {
        throw { kind: "not_found", message: "m" };
      },
    });
    await expect(r.listFonts()).rejects.toBeInstanceOf(TypstNotFoundError);
    await expect(r.compile("", new Map(), { pdfA: false })).rejects.toBeInstanceOf(
      TypstTimeoutError,
    );
  });
});

describe("mapTypstError for values that are not Rust errors", () => {
  it("wraps null, strings and plain objects without a kind", () => {
    for (const v of [null, undefined, "boom", { message: "x" }]) {
      expect(mapTypstError(v)).toBeInstanceOf(PdfExportError);
    }
    expect(mapTypstError("boom").message).toBe("boom");
  });
  it("passes an existing export error through", () => {
    const e = new PdfExportError("x");
    expect(mapTypstError(e)).toBe(e);
  });
});

describe("createTauriRunner typst path", () => {
  it("trims the configured path and treats a blank one as unset", async () => {
    const typstListFonts = vi.fn(async () => []);
    await createTauriRunner({ typstListFonts, typstCompile: vi.fn() }, "  /bin/typst ").listFonts();
    await createTauriRunner({ typstListFonts, typstCompile: vi.fn() }, "   ").listFonts();
    expect(typstListFonts.mock.calls).toEqual([["/bin/typst"], [null]]);
  });
});

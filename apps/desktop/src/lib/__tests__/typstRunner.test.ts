import { describe, expect, it, vi } from "vitest";
import {
  PdfExportError,
  TypstCompileError,
  TypstNotFoundError,
  TypstTimeoutError,
} from "@cadabracraft/export-pdf";
import { createTauriRunner, mapTypstError } from "../export/typstRunner";

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
  it("passes source, files and the PDF/A flag to the bridge", async () => {
    const typstCompile = vi.fn(async () => new Uint8Array([1]));
    const typstListFonts = vi.fn(async () => ["A"]);
    const r = createTauriRunner({ typstCompile, typstListFonts, typstQuery: vi.fn() });
    expect(await r.listFonts()).toEqual(["A"]);
    expect(typstListFonts).toHaveBeenCalledWith();
    await r.compile("src", new Map([["assets/x.png", new Uint8Array([5, 6])]]), { pdfA: true });
    expect(typstCompile).toHaveBeenCalledWith(
      "src",
      [["assets/x.png", new Uint8Array([5, 6])]],
      true,
      false,
    );
    await r.compile("src", new Map(), { pdfA: false, pdfUa: true });
    expect(typstCompile).toHaveBeenLastCalledWith("src", [], false, true);
  });
  it("converts rejections", async () => {
    const r = createTauriRunner({
      typstCompile: async () => {
        throw { kind: "timeout", seconds: 1 };
      },
      typstListFonts: async () => {
        throw { kind: "not_found", message: "m" };
      },
      typstQuery: async () => {
        throw { kind: "compile", message: "error: no match" };
      },
    });
    await expect(r.listFonts()).rejects.toBeInstanceOf(TypstNotFoundError);
    await expect(r.compile("", new Map(), { pdfA: false })).rejects.toBeInstanceOf(
      TypstTimeoutError,
    );
    await expect(r.query("", new Map(), "<a>")).rejects.toBeInstanceOf(TypstCompileError);
  });
  it("passes source, files and the selector to typstQuery and returns the JSON text", async () => {
    const typstQuery = vi.fn(async () => '{"total":2,"starts":[]}');
    const r = createTauriRunner({ typstCompile: vi.fn(), typstListFonts: vi.fn(), typstQuery });
    const files = new Map([["assets/x.png", new Uint8Array([5])]]);
    expect(await r.query("src", files, "<page-report>")).toBe('{"total":2,"starts":[]}');
    expect(typstQuery).toHaveBeenCalledWith(
      "src",
      [["assets/x.png", new Uint8Array([5])]],
      "<page-report>",
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

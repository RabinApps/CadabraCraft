// Runtime-agnostic renderer tests with a fake runner (no typst needed).
import { describe, expect, it } from "vitest";
import { FontNotAvailableError, MissingAssetError, PdfExportError, TypstCompileError, TypstNotFoundError } from "../errors";
import { renderPdf } from "../render";
import { assertNoUnknownFont, assertSafeFilePath, type TypstRunner } from "../runner";
import type { PdfChapter } from "../types";

const book = { title: "B", author: "A", language: "en" };
const doc = (content: object[]): PdfChapter => ({ id: "c", title: "C", doc: { type: "doc", content } as PdfChapter["doc"] });
const text: PdfChapter = doc([{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]);
const image: PdfChapter = doc([{ type: "image", attrs: { src: "assets/a.png" } }]);

function fake(over: Partial<TypstRunner> = {}): TypstRunner & { calls: { source: string; files: Map<string, Uint8Array>; pdfA: boolean }[] } {
  const calls: { source: string; files: Map<string, Uint8Array>; pdfA: boolean }[] = [];
  return {
    calls,
    listFonts: async () => ["Libertinus Serif", "New Computer Modern"],
    compile: async (source, files, o) => {
      calls.push({ source, files, pdfA: o.pdfA });
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    },
    ...over,
  };
}

describe("renderPdf with a custom runner", () => {
  it("passes source, images and the PDF/A flag to the runner", async () => {
    const r = fake();
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await renderPdf(book, [image], { assets: { "assets/a.png": bytes }, pdfA: true }, r);
    expect(out.pdf).toHaveLength(4);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.pdfA).toBe(true);
    expect(r.calls[0]!.source).toContain("img-");
    expect([...r.calls[0]!.files.values()][0]).toBe(bytes);
    expect((await renderPdf(book, [text], {}, r)).pdf).toBeTruthy();
    expect(r.calls[1]!.pdfA).toBe(false);
  });
  it("refuses a missing font before compiling", async () => {
    const r = fake();
    await expect(renderPdf(book, [text], { fonts: { body: "Nope Serif" } }, r)).rejects.toThrow(FontNotAvailableError);
    expect(r.calls).toHaveLength(0);
  });
  it("refuses missing image data before compiling", async () => {
    const r = fake();
    await expect(renderPdf(book, [image], { assets: {} }, r)).rejects.toThrow(MissingAssetError);
    expect(r.calls).toHaveLength(0);
  });
  it("keeps typed runner errors and wraps unknown ones", async () => {
    await expect(renderPdf(book, [text], {}, fake({ listFonts: async () => { throw new TypstNotFoundError("searched PATH"); } }))).rejects.toThrow(TypstNotFoundError);
    await expect(renderPdf(book, [text], {}, fake({ compile: async () => { throw new TypstCompileError("error: boom"); } }))).rejects.toThrow(/boom/);
    const wrapped = await renderPdf(book, [text], {}, fake({ compile: async () => { throw new Error("pipe closed"); } })).catch((e: unknown) => e);
    expect(wrapped).toBeInstanceOf(TypstCompileError);
    expect((wrapped as Error).message).toContain("pipe closed");
  });
});

describe("runner helpers", () => {
  it("rejects paths that could escape the compile directory", () => {
    for (const bad of ["", "../x", "a/../../x", "/abs", "a//b", "../a", "a\\b", "C:/x", "a/\0"]) expect(() => assertSafeFilePath(bad), bad).toThrow(PdfExportError);
    for (const ok of ["main.typ", "assets/img-1.png"]) expect(() => assertSafeFilePath(ok)).not.toThrow();
  });
  it("turns an unknown-font warning into an error naming the font", () => {
    expect(() => assertNoUnknownFont("m.typ:1:16: warning: unknown font family: foo bar")).toThrow(/foo bar/);
    expect(() => assertNoUnknownFont("warning: something else")).not.toThrow();
  });
});

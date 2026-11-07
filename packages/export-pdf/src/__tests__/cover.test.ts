// The cover page: Typst source checks always run; the render checks use real Typst and poppler and skip without them.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissingAssetError, PdfExportError } from "../errors";
import { loadMatterBook } from "./matterBook";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";
import { buildTypstDocument } from "../typst";

const { book, chapters, assets, all } = loadMatterBook();
const png = assets["assets/gradient.png"]!;
const withCover = { assets: { ...assets, "assets/cover.png": png }, cover: "assets/cover.png" };

describe("cover page source", () => {
  it("adds a full-bleed first page and adds a blank back that sets the page counter to 0, before everything else", () => {
    const doc = buildTypstDocument(book, all, withCover);
    const i = doc.source.indexOf("#page(margin: 0pt, header: none, footer: none)");
    expect(i).toBeGreaterThan(0);
    expect(
      doc.source.indexOf("#page(header: none, footer: none)[#counter(page).update(0)]", i),
    ).toBeGreaterThan(i); // the blank back sets the counter
    expect(doc.source.indexOf("#title-page(")).toBeGreaterThan(i);
    expect([...doc.images.keys()]).toContain("assets/cover.png");
  });
  it("writes the cover's alt text in the book's language, and in English for a language without a translation", () => {
    const alt = (language: string): string =>
      buildTypstDocument({ ...book, language }, all, withCover).source;
    expect(alt("en")).toContain('alt: "Cover")');
    expect(alt("de-AT")).toContain('alt: "Umschlag")');
    expect(alt("ar")).toContain('alt: "الغلاف")');
    expect(alt("xx")).toContain('alt: "Cover")');
  });
  it("leaves the source untouched without a cover", () => {
    expect(buildTypstDocument(book, all, { assets }).source).not.toContain(
      "margin: 0pt, header: none",
    );
  });
  it("names a cover that has no bytes", () => {
    expect(() => buildTypstDocument(book, all, { assets, cover: "assets/nope.png" })).toThrow(
      MissingAssetError,
    );
  });
  it.each(["assets/c.gif", "assets/c.svg", "assets/c"])(
    "refuses the unsupported cover %s",
    (cover) => {
      expect(() =>
        buildTypstDocument(book, all, { assets: { ...assets, [cover]: png }, cover }),
      ).toThrow(PdfExportError);
    },
  );
});

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const suite =
  has("typst", ["--version"]) && has("pdfinfo", ["-v"]) && has("pdftotext", ["-v"])
    ? describe
    : describe.skip;

function poppler(tool: string, pdf: Uint8Array, args: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-cover-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    return execFileSync(tool, [...args, file, ...(tool === "pdftotext" ? ["-"] : [])], {
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const pageCount = (pdf: Uint8Array): number =>
  Number(/Pages:\s+(\d+)/.exec(poppler("pdfinfo", pdf))![1]);
const texts = (pdf: Uint8Array): string[] =>
  poppler("pdftotext", pdf, ["-layout"]).split("\f").slice(0, -1);

suite("cover page in the PDF", () => {
  const opts = { template: "novel", trimSize: "5.5x8.5" } as const;
  it("is a first page, full size, with no text, then a blank back; the rest of the book follows as without a cover", async () => {
    const plain = await renderPdf(book, all, { assets, ...opts }, createNodeRunner());
    const covered = await renderPdf(book, all, { ...withCover, ...opts }, createNodeRunner());
    expect(pageCount(covered.pdf)).toBe(pageCount(plain.pdf) + 2);
    expect(poppler("pdfinfo", covered.pdf, ["-f", "1", "-l", "1"])).toContain("396 x 612 pts");
    const [first, back, title] = texts(covered.pdf);
    expect(first!.trim()).toBe("");
    expect(back!.trim()).toBe("");
    expect(title).toContain("The Long Quay");
    expect(texts(covered.pdf).slice(2)).toEqual(texts(plain.pdf)); // numbers and headers are as without a cover
  }, 180_000);
  it("works for a book with no front matter", async () => {
    const r = await renderPdf(book, chapters, { ...withCover, ...opts }, createNodeRunner());
    const plain = await renderPdf(book, chapters, { assets, ...opts }, createNodeRunner());
    const [first, back] = texts(r.pdf);
    expect(first!.trim()).toBe("");
    expect(back!.trim()).toBe("");
    expect(texts(r.pdf).slice(2)).toEqual(texts(plain.pdf));
  }, 180_000);
});

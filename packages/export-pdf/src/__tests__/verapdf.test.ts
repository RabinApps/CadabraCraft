// Integration test: renders the full fixture book with the real `typst` and checks the PDF with the real veraPDF CLI
// (PDF/UA-1 profile `ua1`, and PDF/A-2b profile `2b` for the combined file). Skips when typst or verapdf is missing;
// REQUIRE_VERAPDF=1 (CI) fails instead of skipping. The same check for any PDF: `scripts/validate-pdf.sh`.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFullBook } from "./fixtures";
import { createNodeRunner } from "../node";
import { renderPdf as render } from "../render";
import type { PdfOptions } from "../types";
import { itemsAtDepth, tocBook } from "./tocBook";

const required = process.env.REQUIRE_VERAPDF === "1";
const fetched = fileURLToPath(new URL("../../../../tools/verapdf/verapdf", import.meta.url));

/** The veraPDF launcher: `VERAPDF_BIN`, then `verapdf` on the PATH, then `tools/verapdf/verapdf` (scripts/fetch-verapdf.sh). */
function findVeraPdf(): string | null {
  const candidates = [process.env.VERAPDF_BIN, "verapdf", fetched].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (c !== "verapdf" && !existsSync(c)) continue;
    if (spawnSync(c, ["--version"], { stdio: "ignore", timeout: 60_000 }).status === 0) return c;
  }
  return null;
}
const verapdf = findVeraPdf();
const hasTypst = spawnSync("typst", ["--version"], { stdio: "ignore" }).status === 0;

if (required && (!verapdf || !hasTypst)) {
  describe("veraPDF prerequisites", () => {
    it("typst and verapdf are installed", () => {
      expect({ typst: hasTypst, verapdf: verapdf !== null }).toEqual({
        typst: true,
        verapdf: true,
      });
    });
  });
}

const suite = verapdf && hasTypst ? describe : describe.skip;
const T = 240_000;
const { book, chapters, assets } = loadFullBook();

/** Writes the PDF to a temp file and runs `verapdf --flavour <flavour> --format text` on it. */
function validate(pdf: Uint8Array, flavour: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "cc-verapdf-"));
  try {
    const file = join(dir, "book.pdf");
    writeFileSync(file, pdf);
    const r = spawnSync(verapdf!, ["--flavour", flavour, "--format", "text", file], {
      encoding: "utf8",
      timeout: 200_000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** veraPDF's text report is `PASS <file> <flavour>` or `FAIL ...`; the exit code is 0 only when no rule failed. */
function expectCompliant(pdf: Uint8Array, flavour: string): void {
  const { status, out } = validate(pdf, flavour);
  expect(out, `veraPDF --flavour ${flavour}`).not.toMatch(/^FAIL/m);
  expect(out, `veraPDF --flavour ${flavour}`).toMatch(/^PASS/m);
  expect(status, out).toBe(0);
}

const renderBook = (options: PdfOptions) =>
  render(book, chapters, { assets, ...options }, createNodeRunner());

suite("veraPDF validates the full fixture book", () => {
  it(
    "is PDF/UA-1 compliant with pdfUa",
    async () => {
      const { pdf } = await renderBook({ pdfUa: true });
      expectCompliant(pdf, "ua1");
    },
    T,
  );

  it(
    "is PDF/UA-1 compliant with a Contents page (linked entries, dot leaders and page numbers)",
    async () => {
      const b = tocBook({
        chapters: 3,
        paragraphs: 6,
        headings: [[2, "The Storm"]],
        foreword: true,
      });
      const items = itemsAtDepth(b.items, 2);
      const { pdf } = await render(
        b.book,
        b.pages,
        { toc: { items }, pdfUa: true },
        createNodeRunner(),
      );
      expectCompliant(pdf, "ua1");
    },
    T,
  );

  it(
    "is PDF/UA-1 compliant with a Contents page without page numbers and an entry that links nowhere",
    async () => {
      const b = tocBook({ chapters: 2, paragraphs: 6 });
      const items = [
        ...b.items,
        { key: "custom:x", kind: "custom" as const, level: 0, title: "A note" },
      ];
      const { pdf } = await render(
        b.book,
        b.pages,
        { toc: { items, pageNumbers: false }, pdfUa: true },
        createNodeRunner(),
      );
      expectCompliant(pdf, "ua1");
    },
    T,
  );

  it(
    "is PDF/UA-1 and PDF/A-2b compliant with pdfA and pdfUa together",
    async () => {
      const { pdf } = await renderBook({ pdfA: true, pdfUa: true });
      expectCompliant(pdf, "ua1");
      expectCompliant(pdf, "2b");
    },
    T,
  );
});

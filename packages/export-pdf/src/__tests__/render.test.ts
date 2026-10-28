// Integration tests: run the real `typst` CLI. They skip when typst is missing (set REQUIRE_TYPST=1 to fail instead,
// as CI should). The poppler checks (pdffonts/pdftotext) skip when poppler is missing unless REQUIRE_TYPST=1.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocNode } from "@cadabracraft/shared";
import { FontNotAvailableError, MissingAssetError, TypstNotFoundError } from "../errors";
import { loadFullBook } from "../fixtures";
import { HOSTILE } from "../hostile";
import { createNodeRunner, findTypst } from "../node";
import { renderPdf as render } from "../render";
import type { PdfBook, PdfChapter, PdfOptions } from "../types";

const renderPdf = (b: PdfBook, c: PdfChapter[], o: PdfOptions = {}) =>
  render(b, c, o, createNodeRunner());

const required = process.env.REQUIRE_TYPST === "1";
const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const hasTypst = has("typst", ["--version"]);
const hasPoppler = has("pdfinfo", ["-v"]) && has("pdffonts", ["-v"]) && has("pdftotext", ["-v"]);

if (required && (!hasTypst || !hasPoppler)) {
  describe("integration prerequisites", () => {
    it("typst and poppler (pdfinfo, pdffonts, pdftotext) are installed", () => {
      expect({ typst: hasTypst, poppler: hasPoppler }).toEqual({ typst: true, poppler: true });
    });
  });
}

const typstSuite = hasTypst ? describe : describe.skip;
const popplerSuite = hasTypst && hasPoppler ? describe : describe.skip;

const { book, chapters, assets } = loadFullBook();
const T = 120_000;

/** Run a poppler tool on PDF bytes. */
function poppler(tool: string, pdf: Uint8Array, args: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-pdf-test-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    const target = tool === "pdftotext" ? [...args, file, "-"] : [...args, file];
    return execFileSync(tool, target, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** MediaBox sizes straight from the PDF bytes (Typst writes page dictionaries uncompressed). */
function mediaBoxes(pdf: Uint8Array): number[][] {
  const text = Buffer.from(pdf).toString("latin1");
  return [
    ...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g),
  ].map((m) => m.slice(1).map(Number));
}

const squash = (s: string): string => s.replace(/\s+/g, "");

describe("typst discovery (no typst needed)", () => {
  it("fails clearly when the binary is missing", () => {
    expect(() => findTypst("/definitely/not/here/typst")).toThrow(TypstNotFoundError);
    expect(() => findTypst("/definitely/not/here/typst")).toThrow(/Install Typst/);
  });
  it("fails clearly when PATH has no typst", async () => {
    const saved = process.env.PATH;
    const savedBin = process.env.TYPST_BIN;
    process.env.PATH = "";
    delete process.env.TYPST_BIN;
    try {
      await expect(renderPdf(book, chapters, { assets })).rejects.toThrow(TypstNotFoundError);
    } finally {
      process.env.PATH = saved;
      if (savedBin !== undefined) process.env.TYPST_BIN = savedBin;
    }
  });
});

typstSuite("renderPdf with typst", () => {
  it(
    "produces a PDF at the requested trim sizes (in points)",
    async () => {
      const expected = {
        "5x8": [360, 576],
        "5.5x8.5": [396, 612],
        "6x9": [432, 648],
        "5.25x8": [378, 576],
        "7x10": [504, 720],
      } as const;
      for (const [trimSize, [w, h]] of Object.entries(expected)) {
        const { pdf } = await renderPdf(book, chapters.slice(0, 1), {
          trimSize: trimSize as keyof typeof expected,
          assets,
        });
        expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
        expect(Buffer.from(pdf).subarray(-1024).toString("latin1")).toContain("%%EOF");
        const boxes = mediaBoxes(pdf);
        expect(boxes.length).toBeGreaterThan(0);
        for (const b of boxes) expect(b, trimSize).toEqual([0, 0, w, h]);
      }
    },
    T,
  );

  it(
    "renders every template (modern with an explicit available font)",
    async () => {
      for (const template of ["novel", "nonfiction", "modern"]) {
        const { pdf, fonts } = await renderPdf(book, chapters, {
          template,
          assets,
          ...(template === "modern" ? { fonts: { body: "Libertinus Serif" } } : {}),
        });
        expect(pdf.length, template).toBeGreaterThan(10_000);
        expect(fonts.body).toBeTruthy();
      }
    },
    T,
  );

  it(
    "refuses to export when a font is missing, naming it",
    async () => {
      const err = await renderPdf(book, chapters, {
        assets,
        fonts: { body: "Definitely Not A Font" },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FontNotAvailableError);
      expect((err as Error).message).toContain("Definitely Not A Font");
      const heading = await renderPdf(book, chapters, {
        assets,
        fonts: { heading: "Nope Display" },
      }).catch((e: unknown) => e);
      expect(heading).toBeInstanceOf(FontNotAvailableError);
      expect((heading as Error).message).toContain("Nope Display");
    },
    T,
  );

  it("lists bundled fonts", async () => {
    expect(await createNodeRunner().listFonts()).toContain("Libertinus Serif");
  });

  it(
    "fails when image data is missing",
    async () => {
      await expect(renderPdf(book, chapters, { assets: {} })).rejects.toThrow(MissingAssetError);
      await expect(renderPdf(book, chapters)).rejects.toThrow(MissingAssetError);
    },
    T,
  );

  it(
    "emits PDF/A-2b only when asked",
    async () => {
      const on = await renderPdf(book, chapters.slice(0, 1), { assets, pdfA: true });
      const off = await renderPdf(book, chapters.slice(0, 1), { assets });
      const flag = (pdf: Uint8Array): string => Buffer.from(pdf).toString("latin1");
      expect(flag(on.pdf)).toContain("<pdfaid:part>2</pdfaid:part>");
      expect(flag(on.pdf)).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
      expect(flag(off.pdf)).not.toContain("pdfaid:part");
    },
    T,
  );

  it(
    "reports a Typst compile error with its message",
    async () => {
      // A margin passes validation but a negative-size image path can't; force an error with a bad asset.
      const bad: PdfChapter[] = [
        {
          id: "c",
          title: "C",
          doc: { type: "doc", content: [{ type: "image", attrs: { src: "x.png" } }] },
        },
      ];
      await expect(
        renderPdf(book, bad, { assets: { "x.png": new Uint8Array([1, 2, 3]) } }),
      ).rejects.toThrow(/Typst failed to compile/);
    },
    T,
  );
});

popplerSuite("rendered PDF content (poppler)", () => {
  it(
    "embeds every font and uses the template's family",
    async () => {
      const { pdf } = await renderPdf(book, chapters, { assets });
      const rows = poppler("pdffonts", pdf).split("\n").slice(2).filter(Boolean);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).toMatch(/\s+yes\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/);
      expect(rows.some((r) => r.includes("LibertinusSerif"))).toBe(true);
    },
    T,
  );

  it(
    "contains the text, footnotes and running headers",
    async () => {
      const { pdf } = await renderPdf(book, chapters, { assets });
      const text = poppler("pdftotext", pdf, ["-layout"]);
      for (const s of [
        "The Quay",
        "What the Letter Said",
        "Orwell, 1949, opening line.",
        "A quoted line with <angle brackets> & an ampersand.",
        "Nested two bold",
        "Sub-step b",
        "Figure: a gradient test image.",
        "The Long Quay",
      ]) {
        expect(squash(text), s).toContain(squash(s));
      }
    },
    T,
  );

  it(
    "round-trips hostile strings verbatim",
    async () => {
      const content: DocNode[] = [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "= #Hostile $ title" }],
        },
        ...HOSTILE.map((h): DocNode => ({
          type: "paragraph",
          content: [{ type: "text", text: h }],
        })),
        {
          type: "bulletList",
          content: HOSTILE.slice(0, 5).map((h): DocNode => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: h }] }],
          })),
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: HOSTILE[9]! }] }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x" },
            { type: "footnote", content: [{ type: "text", text: HOSTILE[17]! }] },
            { type: "text", text: ".tail (paren)" },
          ],
        },
      ];
      const { pdf } = await renderPdf(
        { title: HOSTILE[2]!, author: "A $ B", language: "en" },
        [{ id: "h", title: HOSTILE[1]!, doc: { type: "doc", content } }],
        { template: "nonfiction" }, // no hyphenation, so wrapped words stay intact
      );
      const text = squash(poppler("pdftotext", pdf));
      for (const h of HOSTILE) expect(text, h).toContain(squash(h));
      expect(text).toContain(squash("= #Hostile $ title"));
      expect(text).toContain(squash("x1.tail (paren)"));
    },
    T,
  );

  it(
    "starts chapters on right-hand pages for the novel template, with blank versos unnumbered",
    async () => {
      const { pdf } = await renderPdf(book, chapters, { template: "novel", assets });
      const pages = poppler("pdftotext", pdf).split("\f").slice(0, -1);
      const first = (title: string): number =>
        pages.findIndex((p) => p.replace(/^⁂\s*/, "").startsWith(title)) + 1;
      for (const title of ["The Quay", "What the Letter Said", "Hostile Characters", "Afterword"]) {
        const n = first(title);
        expect(n, title).toBeGreaterThan(0);
        expect(n % 2, `${title} on page ${n}`).toBe(1);
      }
      const blanks = pages.filter((p) => p.trim() === "");
      expect(blanks.length).toBeGreaterThan(0); // blank versos exist and carry no header or number
    },
    T,
  );

  it(
    "can start chapters on any page",
    async () => {
      const { pdf } = await renderPdf(book, chapters, {
        template: "novel",
        chapterStart: "any",
        assets,
      });
      const pages = poppler("pdftotext", pdf).split("\f").slice(0, -1);
      expect(pages.filter((p) => p.trim() === "")).toHaveLength(0);
    },
    T,
  );

  it(
    "honors header and page number switches",
    async () => {
      const { pdf } = await renderPdf(book, chapters.slice(0, 1), {
        assets,
        chapterStart: "any",
        pageNumbers: false,
        runningHeaders: false,
      });
      const pages = poppler("pdftotext", pdf).split("\f").slice(0, -1);
      expect(pages[1]).not.toContain("The Long Quay");
      expect(pages[1]!.trim().split("\n").at(-1)).not.toMatch(/^\d+$/);
      const withBoth = await renderPdf(book, chapters.slice(0, 1), { assets, chapterStart: "any" });
      const p2 = poppler("pdftotext", withBoth.pdf).split("\f")[1]!;
      expect(p2.startsWith("The Long Quay")).toBe(true);
      expect(p2.trim().split("\n").at(-1)).toBe("2");
    },
    T,
  );
});

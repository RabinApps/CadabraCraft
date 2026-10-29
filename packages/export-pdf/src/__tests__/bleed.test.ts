import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { PdfExportError } from "../errors";
import { createNodeRunner } from "../node";
import { renderPdf } from "../render";
import { buildTypst } from "../typst";
import { bleedOf, pageBox, pageGeometry } from "../typst/bleed";
import { loadFullBook } from "./fixtures";

const trim = { w: 6, h: 9 };
const margins = { top: 0.75, bottom: 0.75, inside: 0.875, outside: 0.625 };
const { book, chapters, assets } = loadFullBook();
const hasTypst = spawnSync("typst", ["--version"], { stdio: "ignore" }).status === 0;
const typstIt = hasTypst ? it : it.skip;

function mediaBoxes(pdf: Uint8Array): number[][] {
  const text = Buffer.from(pdf).toString("latin1");
  return [
    ...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g),
  ].map((m) => m.slice(1).map(Number));
}

describe("bleedOf", () => {
  it("defaults to none", () => {
    expect(bleedOf({})).toEqual({ bleed: 0, marks: false });
  });
  it("rejects a bad bleed and marks without bleed", () => {
    expect(() => bleedOf({ bleedIn: -1 })).toThrow(PdfExportError);
    expect(() => bleedOf({ bleedIn: 0.6 })).toThrow(/Invalid bleed/);
    expect(() => bleedOf({ bleedIn: Number.NaN })).toThrow(/Invalid bleed/);
    expect(() => bleedOf({ cropMarks: true })).toThrow(/Crop marks need a bleed/);
  });
});

describe("pageGeometry", () => {
  it("is the trim size without bleed", () => {
    const g = pageGeometry(trim, margins, true, {});
    expect([g.width, g.height]).toEqual([6, 9]);
    expect(g.margin).toBe("(top: 0.75in, bottom: 0.75in, inside: 0.875in, outside: 0.625in)");
    expect(g.foreground).toBeNull();
  });
  it("adds the bleed to the top, bottom and outside edges only", () => {
    const g = pageGeometry(trim, margins, true, { bleedIn: 0.125 });
    expect([g.width, g.height]).toEqual([6.125, 9.25]);
    expect(g.margin).toBe("(top: 0.875in, bottom: 0.875in, inside: 0.875in, outside: 0.75in)");
  });
  it("adds the bleed to both sides when the margins are not mirrored", () => {
    const g = pageGeometry(trim, margins, false, { bleedIn: 0.125 });
    expect(g.width).toBe(6.25);
    expect(g.margin).toBe("(top: 0.875in, bottom: 0.875in, left: 1in, right: 0.75in)");
  });
  it("adds bleed and slug on every side with crop marks and draws eight marks", () => {
    const g = pageGeometry(trim, margins, true, { bleedIn: 0.125, cropMarks: true });
    expect([g.width, g.height]).toEqual([6.75, 9.75]);
    expect(g.margin).toContain("inside: 1.25in, outside: 1in");
    expect(g.foreground?.match(/line\(/g)).toHaveLength(8);
  });
});

describe("pageBox", () => {
  it("is the trim size and the template margins without bleed", () => {
    expect(pageBox(trim, margins, true, {})).toEqual({
      width: 6,
      height: 9,
      margins,
      edge: 0,
      marks: false,
    });
  });
  it("adds the bleed to the outer margins and the slug on every side with marks", () => {
    const b = pageBox(trim, margins, true, { bleedIn: 0.125, cropMarks: true });
    expect([b.width, b.height, b.edge, b.marks]).toEqual([6.75, 9.75, 0.375, true]);
    expect(b.margins).toEqual({ top: 1.125, bottom: 1.125, inside: 1.25, outside: 1 });
  });
});

describe("buildTypst with bleed", () => {
  it("writes the grown page size and the marks", () => {
    const src = buildTypst(book, chapters, { bleedIn: 0.125, cropMarks: true });
    expect(src).toMatch(/#set page\(width: \d+(\.\d+)?in, height: /);
    expect(src).toContain("foreground:");
    expect(buildTypst(book, chapters, {})).not.toContain("foreground:");
  });
});

describe("bleed in a real PDF", () => {
  typstIt(
    "grows the page by the bleed (6 x 9 in becomes 6.125 x 9.25 in)",
    async () => {
      const { pdf } = await renderPdf(
        book,
        chapters,
        { trimSize: "6x9", bleedIn: 0.125, assets },
        createNodeRunner(),
      );
      const boxes = mediaBoxes(pdf);
      expect(boxes.length).toBeGreaterThan(2);
      for (const b of boxes) {
        expect(b[2]).toBeCloseTo(6.125 * 72, 0);
        expect(b[3]).toBeCloseTo(9.25 * 72, 0);
      }
    },
    120_000,
  );
  typstIt(
    "grows the page by bleed and slug with crop marks (6.75 x 9.75 in)",
    async () => {
      const { pdf } = await renderPdf(
        book,
        chapters,
        { trimSize: "6x9", bleedIn: 0.125, cropMarks: true, assets },
        createNodeRunner(),
      );
      for (const b of mediaBoxes(pdf)) {
        expect(b[2]).toBeCloseTo(6.75 * 72, 0);
        expect(b[3]).toBeCloseTo(9.75 * 72, 0);
      }
    },
    120_000,
  );
});

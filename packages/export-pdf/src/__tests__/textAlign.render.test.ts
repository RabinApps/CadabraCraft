// Integration: real Typst and poppler. Skips without them unless REQUIRE_TYPST=1 (render.test.ts reports missing prerequisites).
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocNode } from "@cadabracraft/shared";
import { createNodeRunner } from "../node";
import { renderPdf as render } from "../render";

const has = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const suite = has("typst", ["--version"]) && has("pdftotext", ["-v"]) ? describe : describe.skip;

const book = { title: "Aligned", author: "A. Writer", language: "en" };
const para = (word: string, textAlign?: string): DocNode => ({
  type: "paragraph",
  ...(textAlign ? { attrs: { textAlign } } : {}),
  content: [{ type: "text", text: word }],
});

/** Left and right edge (pt) of the first occurrence of each word on page 1, and the page width. */
function edges(pdf: Uint8Array, words: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "cc-align-"));
  try {
    const file = join(dir, "x.pdf");
    writeFileSync(file, pdf);
    const xml = execFileSync("pdftotext", ["-bbox", file, "-"], {
      encoding: "utf8",
    });
    const width = Number(/<page width="([\d.]+)"/.exec(xml)![1]);
    const out: Record<string, { x0: number; x1: number; y0: number }> = {};
    for (const w of words) {
      const m = new RegExp(`xMin="([\\d.]+)" yMin="([\\d.]+)" xMax="([\\d.]+)"[^>]*>${w}<`).exec(
        xml,
      )!;
      if (!m) throw new Error(`no ${w} in ${xml.slice(0, 1500)}`);
      out[w] = { x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]) };
    }
    return { width, out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

suite("text alignment, real Typst", () => {
  it("centres and right-aligns the paragraphs the author chose, and leaves the others on the template's layout", async () => {
    const doc = {
      type: "doc" as const,
      content: [
        para("Opening"),
        para("Plain"),
        para("Middle", "center"),
        para("Right", "end"),
        para("Left", "start"),
        para("After"),
      ],
    };
    const { pdf } = await render(
      book,
      [{ id: "c", title: "C", doc }],
      { fonts: { body: "Libertinus Serif" } },
      createNodeRunner(),
    );
    const { width, out } = edges(pdf, ["Plain", "Middle", "Right", "Left", "After"]);
    const mid = (w: string) => (out[w]!.x0 + out[w]!.x1) / 2;
    // The middle of the text box, which the binding margin moves a little off the middle of the page.
    expect(Math.abs(mid("Middle") - width / 2)).toBeLessThan(15);
    expect(out["Right"]!.x1).toBeGreaterThan(width / 2 + 40);
    expect(out["Left"]!.x0).toBeLessThan(width / 2 - 40);
    // Left-aligned is flush with the margin: no first-line indent, which the template's body text may have.
    expect(out["Left"]!.x0).toBeLessThanOrEqual(out["After"]!.x0);
    // The aligned scopes keep the template's vertical rhythm: the gaps are equal.
    const gaps = ["Plain", "Middle", "Right", "Left", "After"].map((w) => out[w]!.y0);
    const steps = gaps.slice(1).map((y, i) => Math.round(y - gaps[i]!));
    expect(new Set(steps).size).toBe(1);
  }, 120_000);

  it("moves a heading the template sets in its own alignment, and only the one the author chose", async () => {
    const head = (word: string, textAlign?: string) => ({
      type: "heading" as const,
      attrs: { level: 2, ...(textAlign ? { textAlign } : {}) },
      content: [{ type: "text" as const, text: word }],
    });
    const doc = {
      type: "doc" as const,
      content: [
        para("Opening"),
        head("Plain"),
        head("Centred", "center"),
        head("Righted", "end"),
        head("Lefted", "start"),
      ],
    };
    const { pdf } = await render(
      book,
      [{ id: "c", title: "C", doc }],
      { fonts: { body: "Libertinus Serif", heading: "Libertinus Serif" } },
      createNodeRunner(),
    );
    const { width, out } = edges(pdf, ["Plain", "Centred", "Righted", "Lefted"]);
    expect(Math.abs((out["Centred"]!.x0 + out["Centred"]!.x1) / 2 - width / 2)).toBeLessThan(15);
    expect(out["Righted"]!.x1).toBeGreaterThan(width / 2 + 40);
    expect(out["Lefted"]!.x0).toBeLessThan(width / 2 - 40);
    // The default template centres a level 2 heading, so "Left" is the author's doing and a heading with no choice stays as the template has it.
    expect(Math.abs((out["Plain"]!.x0 + out["Plain"]!.x1) / 2 - width / 2)).toBeLessThan(15);
  }, 120_000);
});

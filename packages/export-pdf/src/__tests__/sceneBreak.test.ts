import { describe, expect, it } from "vitest";
import {
  SCENE_BREAK_ORNAMENT_IDS,
  SCENE_BREAK_ORNAMENTS,
  SceneBreakOrnamentError,
} from "@cadabracraft/shared";
import { listTemplates } from "@cadabracraft/templates";
import type { ChapterDoc } from "@cadabracraft/shared";
import { buildTypst } from "../typst";
import type { PdfChapter } from "../types";

const book = { title: "Sample Book", author: "Test Author", language: "en" };
const doc: ChapterDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Before." }] },
    { type: "sceneBreak" },
    { type: "paragraph", content: [{ type: "text", text: "After." }] },
  ],
};
const chapters: PdfChapter[] = [{ id: "ch1", title: "Chapter One", doc }];
const sceneLine = (src: string): string =>
  src.split("\n").find((l) => l.startsWith("#let scene-break()")) ?? "";

describe("scene-break ornament in the PDF source", () => {
  it("draws the template's own glyph when no ornament is chosen", () => {
    for (const t of listTemplates()) {
      const src = buildTypst(book, chapters, { template: t.id });
      expect(sceneLine(src)).toContain(`"${t.print.sceneBreak.glyph}"))`);
    }
  });

  it("matches the template's glyph when the matching ornament is chosen (default unchanged)", () => {
    for (const t of listTemplates()) {
      const match = SCENE_BREAK_ORNAMENT_IDS.find(
        (id) => SCENE_BREAK_ORNAMENTS[id].glyph === t.print.sceneBreak.glyph,
      );
      expect(match, `an ornament for ${t.id}`).toBeDefined();
      expect(buildTypst(book, chapters, { template: t.id, sceneBreak: match })).toBe(
        buildTypst(book, chapters, { template: t.id }),
      );
    }
  });

  it("draws a chosen ornament in place of the template's glyph", () => {
    const src = buildTypst(book, chapters, { sceneBreak: "asterism" });
    expect(sceneLine(src)).toContain('"⁂"))');
    expect(src).not.toContain('"*   *   *"))');
    expect(buildTypst(book, chapters, { sceneBreak: "none" })).toContain('""))');
  });

  it("throws on an ornament id the library does not list", () => {
    expect(() => buildTypst(book, chapters, { sceneBreak: "rule" as never })).toThrow(
      SceneBreakOrnamentError,
    );
  });
});

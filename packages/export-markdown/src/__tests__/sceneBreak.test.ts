import { describe, expect, it } from "vitest";
import type { ChapterDoc } from "@cadabracraft/shared";
import { SceneBreakOrnamentError } from "@cadabracraft/shared";
import { chapterToMarkdown } from "../index";

const doc: ChapterDoc = { type: "doc", content: [{ type: "sceneBreak" }] };

describe("scene-break mark in Markdown", () => {
  it("writes * * * when no ornament is chosen", () => {
    expect(chapterToMarkdown(doc)).toBe("* * *\n");
  });

  it("writes the chosen ornament's text", () => {
    expect(chapterToMarkdown(doc, { sceneBreak: "asterism" })).toBe("⁂\n");
    expect(chapterToMarkdown(doc, { sceneBreak: "none" })).toBe("");
  });

  it("throws on an ornament id the library does not list", () => {
    expect(() => chapterToMarkdown(doc, { sceneBreak: "rule" as never })).toThrow(
      SceneBreakOrnamentError,
    );
  });
});

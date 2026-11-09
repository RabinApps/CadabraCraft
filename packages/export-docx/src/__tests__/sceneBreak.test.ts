import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { ChapterDoc } from "@cadabracraft/shared";
import { SceneBreakOrnamentError } from "@cadabracraft/shared";
import { buildDocx } from "../docx";

const doc: ChapterDoc = {
  type: "doc",
  content: [{ type: "sceneBreak" }],
};
const book = { title: "T", author: "A", language: "en" };
const document = (opts: Parameters<typeof buildDocx>[2] = {}): string =>
  strFromU8(unzipSync(buildDocx(book, [{ title: "One", doc }], opts))["word/document.xml"]!);
const scene = (text: string): string =>
  `<w:pStyle w:val="SceneBreak"/></w:pPr><w:r><w:t>${text}</w:t></w:r>`;

describe("scene-break mark in Word", () => {
  it("writes a centred # when no ornament is chosen", () => {
    expect(document()).toContain(scene("#"));
  });

  it("writes the chosen ornament's text", () => {
    expect(document({ sceneBreak: "asterism" })).toContain(scene("⁂"));
    expect(document({ sceneBreak: "three-dots" })).toContain(scene("* * *"));
    expect(document({ sceneBreak: "none" })).toContain(scene(""));
  });

  it("throws on an ornament id the library does not list", () => {
    expect(() => document({ sceneBreak: "rule" as never })).toThrow(SceneBreakOrnamentError);
  });
});

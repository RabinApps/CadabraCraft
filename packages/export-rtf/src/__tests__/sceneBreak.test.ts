import { describe, expect, it } from "vitest";
import type { ChapterDoc } from "@cadabracraft/shared";
import { SceneBreakOrnamentError } from "@cadabracraft/shared";
import { buildRtf } from "../rtf";

const doc: ChapterDoc = { type: "doc", content: [{ type: "sceneBreak" }] };
const book = { title: "T", author: "A", language: "en" };
const rtf = (opts: Parameters<typeof buildRtf>[2] = {}): string =>
  buildRtf(book, [{ title: "One", doc }], opts);

describe("scene-break mark in RTF", () => {
  it("writes a centred # when no ornament is chosen", () => {
    expect(rtf()).toContain("\\fi0\\qc #\\par");
  });

  it("writes the chosen ornament, escaped as RTF", () => {
    expect(rtf({ sceneBreak: "asterism" })).toContain("\\fi0\\qc \\u8258?\\par");
    expect(rtf({ sceneBreak: "three-dots" })).toContain("\\fi0\\qc * * *\\par");
    expect(rtf({ sceneBreak: "none" })).toContain("\\fi0\\qc \\par");
  });

  it("throws on an ornament id the library does not list", () => {
    expect(() => rtf({ sceneBreak: "rule" as never })).toThrow(SceneBreakOrnamentError);
  });
});

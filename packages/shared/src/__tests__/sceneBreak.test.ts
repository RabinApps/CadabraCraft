import { describe, expect, it } from "vitest";
import {
  SCENE_BREAK_ORNAMENT_IDS,
  SCENE_BREAK_ORNAMENTS,
  SceneBreakOrnamentError,
  isSceneBreakOrnamentId,
  sceneBreakGlyph,
  sceneBreakOrnament,
  sceneBreakText,
} from "../sceneBreak";

describe("scene-break ornaments", () => {
  it("lists every id with a text mark and no edge whitespace; only none has no glyph", () => {
    for (const id of SCENE_BREAK_ORNAMENT_IDS) {
      const o = SCENE_BREAK_ORNAMENTS[id];
      expect(o.text).toBe(o.text.trim());
      if (id !== "none") expect(o.glyph).not.toBe("");
    }
    expect(SCENE_BREAK_ORNAMENT_IDS).toContain("none");
  });

  it("accepts only listed ids", () => {
    for (const id of SCENE_BREAK_ORNAMENT_IDS) expect(isSceneBreakOrnamentId(id)).toBe(true);
    for (const v of ["rule", "Asterism", "", null, 3, undefined])
      expect(isSceneBreakOrnamentId(v)).toBe(false);
  });

  it("returns the entry for a listed id and throws for any other", () => {
    expect(sceneBreakOrnament("asterism")).toEqual({ glyph: "⁂", text: "⁂" });
    expect(() => sceneBreakOrnament("rule")).toThrow(SceneBreakOrnamentError);
    expect(() => sceneBreakOrnament("rule")).toThrow('Unknown scene-break ornament "rule"');
  });

  it("uses the template's own glyph when no ornament is chosen", () => {
    expect(sceneBreakGlyph("⁂", undefined)).toBe("⁂");
    expect(sceneBreakGlyph("⁂", "three-dots")).toBe("*   *   *");
    expect(sceneBreakGlyph("⁂", "none")).toBe("");
    expect(() => sceneBreakGlyph("⁂", "bogus")).toThrow(SceneBreakOrnamentError);
  });

  it("uses the exporter's own mark when no ornament is chosen", () => {
    expect(sceneBreakText("#", undefined)).toBe("#");
    expect(sceneBreakText("#", "fleuron")).toBe("❦");
    expect(sceneBreakText("* * *", "none")).toBe("");
    expect(() => sceneBreakText("#", "bogus")).toThrow(SceneBreakOrnamentError);
  });
});

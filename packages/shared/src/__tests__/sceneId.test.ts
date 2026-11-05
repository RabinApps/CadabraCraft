import { describe, expect, it } from "vitest";
import { isValidSceneId } from "../ids";

describe("isValidSceneId", () => {
  it("accepts the page-id rule", () => {
    expect(isValidSceneId("sc-1")).toBe(true);
    expect(isValidSceneId("Scene_A")).toBe(true);
    expect(isValidSceneId(`s${"a".repeat(63)}`)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const bad of ["", "1scene", "sc ene", "a".repeat(65), `s${"a".repeat(64)}`, 7, null])
      expect(isValidSceneId(bad)).toBe(false);
  });
});

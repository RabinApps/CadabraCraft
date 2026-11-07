import { describe, expect, it } from "vitest";
import type { SceneStatus } from "../../../lib/scenes/scenes";
import { sceneStatusDot, sceneStatusTone, sceneStatusWord } from "../labels";

const statuses: SceneStatus[] = ["", "outline", "draft", "revised", "final"];

describe("scene status labels", () => {
  it("names every status, and the missing one", () => {
    expect(statuses.map(sceneStatusWord)).toEqual([
      "No status",
      "Outline",
      "Draft",
      "Revised",
      "Final",
    ]);
  });

  it("warns for a draft, marks revised and final as done, and leaves the rest plain", () => {
    expect(statuses.map(sceneStatusTone)).toEqual(["none", "none", "warn", "success", "success"]);
  });

  it("has a dot colour for every status", () => {
    expect(statuses.every((s) => sceneStatusDot[s].startsWith("bg-"))).toBe(true);
  });
});

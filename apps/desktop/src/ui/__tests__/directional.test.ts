import { Bold, ChevronLeft, Redo2 } from "lucide-react";
import { describe, expect, it } from "vitest";
import { mirrorClass } from "../directional";

describe("mirrorClass", () => {
  it("mirrors icons that point along the reading axis", () => {
    expect(mirrorClass(ChevronLeft)).toBe("rtl:-scale-x-100");
    expect(mirrorClass(Redo2)).toBe("rtl:-scale-x-100");
  });

  it("leaves other icons alone", () => {
    expect(mirrorClass(Bold)).toBeUndefined();
  });
});

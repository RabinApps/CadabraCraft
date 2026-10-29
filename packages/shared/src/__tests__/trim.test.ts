import { describe, expect, it } from "vitest";
import { TRIM_SIZE_IDS, isTrimSize } from "../trim";

describe("isTrimSize", () => {
  it("accepts every listed size", () => {
    for (const id of TRIM_SIZE_IDS) expect(isTrimSize(id)).toBe(true);
  });

  it("refuses unknown sizes and other types", () => {
    expect(isTrimSize("4x4")).toBe(false);
    expect(isTrimSize("")).toBe(false);
    expect(isTrimSize(6)).toBe(false);
    expect(isTrimSize(null)).toBe(false);
  });
});

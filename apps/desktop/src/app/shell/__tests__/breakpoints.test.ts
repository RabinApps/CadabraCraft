import { describe, expect, it } from "vitest";
import { LG_QUERY, MD_QUERY } from "../breakpoints";

describe("breakpoints", () => {
  it("match Tailwind's lg and md widths", () => {
    expect(LG_QUERY).toBe("(min-width: 1024px)");
    expect(MD_QUERY).toBe("(min-width: 768px)");
  });
});

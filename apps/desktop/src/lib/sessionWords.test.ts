import { describe, expect, it } from "vitest";
import { goalProgress, sessionWords } from "./sessionWords";

describe("session words", () => {
  it("counts words added since the baseline and never goes negative", () => {
    expect(sessionWords(1000, 1250)).toBe(250);
    expect(sessionWords(1000, 900)).toBe(0);
  });
  it("reports progress capped at 1, and 0 without a goal", () => {
    expect(goalProgress(250, 500)).toBe(0.5);
    expect(goalProgress(900, 500)).toBe(1);
    expect(goalProgress(100, 0)).toBe(0);
  });
});

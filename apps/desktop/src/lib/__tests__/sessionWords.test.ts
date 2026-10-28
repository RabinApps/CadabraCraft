import { describe, expect, it } from "vitest";
import { sessionWords } from "../sessionWords";

describe("session words", () => {
  it("counts words added since the baseline and never goes negative", () => {
    expect(sessionWords(1000, 1250)).toBe(250);
    expect(sessionWords(1000, 900)).toBe(0);
  });
});

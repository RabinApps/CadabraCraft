import { describe, expect, it } from "vitest";
import { readingMinutes } from "../reading/readingTime";

describe("readingMinutes", () => {
  it("is 0 for no words and at least 1 otherwise", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(5)).toBe(1);
  });
  it("rounds at 230 words per minute", () => {
    expect(readingMinutes(2300)).toBe(10);
    expect(readingMinutes(2420)).toBe(11);
  });
});

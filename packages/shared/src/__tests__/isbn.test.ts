import { describe, expect, it } from "vitest";
import { normalizeIsbn } from "../isbn";

describe("normalizeIsbn", () => {
  it("keeps a valid ISBN-13 and strips hyphens, spaces and an ISBN prefix", () => {
    expect(normalizeIsbn("978-3-16-148410-0")).toBe("9783161484100");
    expect(normalizeIsbn(" ISBN 978 3 16 148410 0 ")).toBe("9783161484100");
    expect(normalizeIsbn("ISBN-13: 9783161484100")).toBe("9783161484100");
  });
  it("converts an ISBN-10, including a trailing X", () => {
    expect(normalizeIsbn("0-306-40615-2")).toBe("9780306406157");
    expect(normalizeIsbn("0-8044-2957-x")).toBe("9780804429573");
  });
  it("returns null for empty, malformed or wrong-checksum text", () => {
    for (const bad of [null, undefined, "", "  ", "978-3-16-148410-1", "0-306-40615-3", "12345", "9783161484100x", "ABC", "9793161484100", "1234567890123"]) {
      expect(normalizeIsbn(bad), String(bad)).toBeNull();
    }
  });
});

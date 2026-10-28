import { describe, expect, it } from "vitest";
import { isValidEntryId, normalizeLinkUrl, safeHref } from "../index";

describe("safeHref", () => {
  it("keeps http, https and mailto links (normalized)", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("  HTTP://Example.com ")).toBe("http://example.com/");
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "example.com",
    "",
    "  ",
    "https://a b.test",
    "http://",
  ])("refuses %j", (v) => {
    expect(safeHref(v)).toBeNull();
  });
});

describe("normalizeLinkUrl", () => {
  it("adds https to a bare domain and keeps allowed schemes", () => {
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com/");
    expect(normalizeLinkUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(normalizeLinkUrl("http://x.test")).toBe("http://x.test/");
  });
  it.each(["javascript:alert(1)", "file:///etc/passwd", "", "  ", "two words.com"])(
    "refuses %j",
    (v) => {
      expect(normalizeLinkUrl(v)).toBeNull();
    },
  );
});

describe("isValidEntryId", () => {
  it.each(["ch-1", "title-page", "a", "Ch_2", "x".repeat(64)])("accepts %j", (v) => {
    expect(isValidEntryId(v)).toBe(true);
  });
  it.each(["", "1a", "-a", "a b", "a/b", "../x", "a.b", "é", "a:b", "x".repeat(65)])(
    "refuses %j",
    (v) => {
      expect(isValidEntryId(v)).toBe(false);
    },
  );
});

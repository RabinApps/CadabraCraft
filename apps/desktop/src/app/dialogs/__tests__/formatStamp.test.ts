import { describe, expect, it } from "vitest";
import { formatStamp } from "../formatStamp";

describe("formatStamp", () => {
  it("formats a UTC stamp as a medium date and short time", () => {
    const expected = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(Date.UTC(2026, 2, 5, 14, 7)));
    expect(formatStamp("20260305-1407", "en")).toBe(expected);
  });

  it("falls back to the default locale when the locale is not a real one", () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(Date.UTC(2026, 11, 31, 23, 59)));
    expect(formatStamp("20261231-2359", "not a locale!")).toBe(expected);
  });
});

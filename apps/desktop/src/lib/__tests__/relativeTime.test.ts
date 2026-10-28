import { describe, expect, it } from "vitest";
import { relativeTime } from "../relativeTime";

const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();
const now = noon(2026, 10, 28);

describe("relativeTime", () => {
  it("counts calendar days, not 24-hour spans", () => {
    expect(relativeTime(new Date(2026, 9, 28, 0, 1).getTime(), now, "en")).toBe("today");
    expect(relativeTime(new Date(2026, 9, 27, 23, 59).getTime(), now, "en")).toBe("yesterday");
    expect(relativeTime(noon(2026, 10, 25), now, "en")).toBe("3 days ago");
  });
  it("moves to weeks, months and years", () => {
    expect(relativeTime(noon(2026, 10, 18), now, "en")).toBe("last week");
    expect(relativeTime(noon(2026, 10, 7), now, "en")).toBe("3 weeks ago");
    expect(relativeTime(noon(2026, 8, 20), now, "en")).toBe("2 months ago");
    expect(relativeTime(noon(2024, 10, 28), now, "en")).toBe("2 years ago");
  });
  it("never reports the future, and follows the language", () => {
    expect(relativeTime(noon(2026, 11, 3), now, "en")).toBe("today");
    expect(relativeTime(noon(2026, 10, 27), now, "de")).toBe("gestern");
  });
});

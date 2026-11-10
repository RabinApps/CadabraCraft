import { describe, expect, it } from "vitest";
import { dayNumber, daysBetween, isDateKey, shiftDateKey, weekdayOf } from "../dates";

describe("isDateKey", () => {
  it("accepts a real YYYY-MM-DD day, leap days included", () => {
    expect(isDateKey("2026-11-09")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2000-02-29")).toBe(true);
  });

  it("refuses anything that is not that shape", () => {
    expect(isDateKey(20261109)).toBe(false);
    expect(isDateKey(null)).toBe(false);
    expect(isDateKey("2026-1-09")).toBe(false);
    expect(isDateKey("2026/11/09")).toBe(false);
    expect(isDateKey("2026-11-09T00:00")).toBe(false);
    expect(isDateKey("")).toBe(false);
  });

  it("refuses a day that does not exist", () => {
    expect(isDateKey("2027-02-29")).toBe(false);
    expect(isDateKey("2026-04-31")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-00-10")).toBe(false);
    expect(isDateKey("2026-11-00")).toBe(false);
  });
});

describe("dayNumber", () => {
  it("counts whole days from 1970-01-01", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("1969-12-31")).toBe(-1);
  });

  it("throws on text that is not a real date", () => {
    expect(() => dayNumber("2027-02-29")).toThrow(RangeError);
    expect(() => dayNumber("not a date")).toThrow(/not a calendar date/);
  });
});

describe("shiftDateKey", () => {
  it("moves forward and backward across months, years and a leap day", () => {
    expect(shiftDateKey("2026-11-09", 0)).toBe("2026-11-09");
    expect(shiftDateKey("2026-11-09", 1)).toBe("2026-11-10");
    expect(shiftDateKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDateKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDateKey("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("daysBetween", () => {
  it("is zero for the same day, positive forward and negative backward", () => {
    expect(daysBetween("2026-11-09", "2026-11-09")).toBe(0);
    expect(daysBetween("2026-11-09", "2026-11-18")).toBe(9);
    expect(daysBetween("2026-11-18", "2026-11-09")).toBe(-9);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("weekdayOf", () => {
  it("gives the day of the week, 0 for Sunday", () => {
    expect(weekdayOf("2026-11-08")).toBe(0);
    expect(weekdayOf("2026-11-09")).toBe(1);
    expect(weekdayOf("2026-11-14")).toBe(6);
  });
});

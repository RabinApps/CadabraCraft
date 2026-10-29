import { describe, expect, it } from "vitest";
import type { PageReport } from "@cadabracraft/export-pdf";
import { reportBookPages, reportStartNumber, usableReport } from "../pageReport";

const start = (id: string, page: number, number: string) => ({ id, kind: "chapter", page, number });
const withFront: PageReport = {
  total: 20,
  starts: [
    start("title", 1, ""),
    start("fore", 3, "iii"),
    start("c1", 5, "1"),
    start("c2", 11, "7"),
  ],
};

describe("usableReport", () => {
  it("rejects a missing report and one with no total or no starts", () => {
    expect(usableReport(null)).toBeNull();
    expect(usableReport({ total: 0, starts: [] })).toBeNull();
    expect(usableReport({ total: 4, starts: [] })).toBeNull();
    expect(usableReport(withFront)).toBe(withFront);
  });
});

describe("reportBookPages", () => {
  it("counts from the page numbered 1, after the front matter", () => {
    expect(reportBookPages(withFront)).toBe(16);
  });
  it("counts every page when nothing is numbered 1", () => {
    expect(reportBookPages({ total: 9, starts: [start("c1", 1, "")] })).toBe(9);
  });
});

describe("reportStartNumber", () => {
  it("gives the printed arabic number of an entry's first page", () => {
    expect(reportStartNumber(withFront, "c2")).toBe(7);
  });
  it("gives null for roman or empty numbers and for unknown ids", () => {
    expect(reportStartNumber(withFront, "fore")).toBeNull();
    expect(reportStartNumber(withFront, "title")).toBeNull();
    expect(reportStartNumber(withFront, "nope")).toBeNull();
  });
});

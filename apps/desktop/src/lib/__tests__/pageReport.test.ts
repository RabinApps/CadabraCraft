import { describe, expect, it } from "vitest";
import type { PageReport } from "@cadabracraft/export-pdf";
import { reportChapterMarks, usableReport } from "../page/pageReport";

const start = (id: string, page: number, number: string, end = page) => ({
  id,
  kind: "chapter",
  page,
  end,
  number,
});
const withFront: PageReport = {
  total: 20,
  starts: [
    start("title", 1, ""),
    start("fore", 3, "iii"),
    start("c1", 5, "1", 9),
    start("c2", 11, "7", 20),
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

describe("reportChapterMarks", () => {
  it("gives a chapter's blocks with where it starts and ends, or null without marks", () => {
    const blocks = [{ block: 0, leaf: 0, kind: "p" as const, page: 5, splits: [] }];
    const report: PageReport = { ...withFront, blocks: { c1: blocks } };
    expect(reportChapterMarks(report, "c1")).toEqual({ base: 5, end: 9, blocks });
    expect(reportChapterMarks(report, "c2")).toBeNull();
    expect(reportChapterMarks(report, "nope")).toBeNull();
    expect(reportChapterMarks(withFront, "c1")).toBeNull();
  });
});

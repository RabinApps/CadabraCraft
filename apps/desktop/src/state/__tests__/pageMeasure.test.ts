import { beforeEach, describe, expect, it } from "vitest";
import { markMeasureStale, setMeasured, setMeasureError, usePageMeasure } from "../pageMeasure";

const report = { total: 3, starts: [{ id: "a", kind: "chapter", page: 1, number: "1" }] };

beforeEach(() => usePageMeasure.setState({ report: null, fresh: false, error: null }));

describe("page measure store", () => {
  it("is fresh once a report arrives and stale as soon as the book changes", () => {
    setMeasured(report);
    expect(usePageMeasure.getState()).toMatchObject({ report, fresh: true, error: null });
    markMeasureStale();
    expect(usePageMeasure.getState()).toMatchObject({ report, fresh: false });
  });
  it("marking stale twice keeps the same state object", () => {
    markMeasureStale();
    const before = usePageMeasure.getState();
    markMeasureStale();
    expect(usePageMeasure.getState()).toBe(before);
  });
  it("keeps the last report when a measure fails, but not fresh", () => {
    setMeasured(report);
    setMeasureError("Typst is not installed");
    expect(usePageMeasure.getState()).toMatchObject({
      report,
      fresh: false,
      error: "Typst is not installed",
    });
  });
});

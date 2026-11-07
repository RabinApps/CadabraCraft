import { beforeEach, describe, expect, it } from "vitest";
import {
  breaksReport,
  freshReport,
  markMeasureStale,
  setChapterMeasured,
  setMeasured,
  setMeasureError,
  usePageMeasure,
} from "../pages/pageMeasure";

const report = { total: 3, starts: [{ id: "a", kind: "chapter", page: 1, end: 1, number: "1" }] };

beforeEach(() =>
  usePageMeasure.setState({
    report: null,
    fresh: false,
    reportAt: 0,
    chapter: null,
    chapterFresh: false,
    error: null,
  }),
);
const state = () => usePageMeasure.getState();

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

describe("a chapter measured on its own", () => {
  const own = { total: 2, starts: [{ id: "a", kind: "chapter", page: 1, end: 2, number: "1" }] };

  it("is fresh until the book changes, like the book's report", () => {
    setChapterMeasured("a", own);
    expect(state()).toMatchObject({ chapter: { id: "a", report: own }, chapterFresh: true });
    markMeasureStale();
    expect(state().chapterFresh).toBe(false);
    expect(state().chapter?.report).toBe(own);
  });

  it("is the report for breaks: the chapter's own or the book's, whichever is newer, and the book's only when it has marks", () => {
    const marked = {
      ...report,
      blocks: { a: [{ block: 0, leaf: 0, kind: "p" as const, page: 1, splits: [] }] },
    };
    expect(breaksReport(state(), "a")).toBeNull();
    // A book measured without marks says nothing about the breaks.
    setMeasured(report);
    expect(breaksReport(state(), "a")).toBeNull();
    setMeasured(marked);
    expect(breaksReport(state(), "a")).toEqual({ report: marked, at: state().reportAt });
    expect(breaksReport(state(), "b")).toBeNull();
    setChapterMeasured("a", own);
    expect(breaksReport(state(), "a")).toEqual({ report: own, at: state().chapter!.at });
    // Another page entry has nothing of its own.
    expect(breaksReport(state(), "b")).toBeNull();
    // A newer report of the book wins again.
    setMeasured(marked);
    expect(breaksReport(state(), "a")).toEqual({ report: marked, at: state().reportAt });
    usePageMeasure.setState({ report: report });
    expect(breaksReport(state(), "a")).toEqual({ report: own, at: state().chapter!.at });
  });

  it("is a current report only while it is of the text as it is", () => {
    expect(freshReport(state(), "a")).toBeNull();
    setChapterMeasured("a", own);
    expect(freshReport(state(), "a")).toBe(own);
    expect(freshReport(state(), "b")).toBeNull();
    setMeasured(report);
    expect(freshReport(state(), "b")).toBe(report);
    markMeasureStale();
    expect(freshReport(state(), "a")).toBeNull();
  });
});

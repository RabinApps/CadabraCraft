import { beforeEach, describe, expect, it } from "vitest";
import { setEntryPages, setPageCount, usePageCount } from "../pageCount";

beforeEach(() => {
  usePageCount.setState({ count: 0, current: 1, exact: false, byId: {}, key: "" });
});

describe("page count", () => {
  it("holds the chapter's page count and the cursor's page", () => {
    setPageCount(12, 3);
    expect(usePageCount.getState()).toMatchObject({ count: 12, current: 3, exact: false });
  });
  it("keeps the cursor's page when only the count changes, within the new count", () => {
    setPageCount(12, 9);
    setPageCount(20);
    expect(usePageCount.getState().current).toBe(9);
    setPageCount(5);
    expect(usePageCount.getState().current).toBe(5);
  });
  it("resets when Page view is off", () => {
    setPageCount(12, 9);
    setPageCount(0);
    expect(usePageCount.getState()).toMatchObject({ count: 0, current: 1, exact: false });
  });
  it("remembers whether the breaks are exact, and forgets it with Page view", () => {
    setPageCount(4, 2, true);
    expect(usePageCount.getState().exact).toBe(true);
    setPageCount(4, 3);
    expect(usePageCount.getState().exact).toBe(true);
    setPageCount(4, 3, false);
    expect(usePageCount.getState().exact).toBe(false);
    setPageCount(4, 3, true);
    setPageCount(0);
    expect(usePageCount.getState().exact).toBe(false);
  });
  it("does not change state for the same values", () => {
    setPageCount(4, 2);
    const before = usePageCount.getState();
    setPageCount(4, 2);
    expect(usePageCount.getState()).toBe(before);
  });
});

describe("measured entry pages", () => {
  it("keeps a page count per entry under the layout key", () => {
    setEntryPages("ch-1", 5, "novel|6x9|serif|");
    setEntryPages("ch-2", 3, "novel|6x9|serif|");
    expect(usePageCount.getState().byId).toEqual({ "ch-1": 5, "ch-2": 3 });
    expect(usePageCount.getState().key).toBe("novel|6x9|serif|");
  });

  it("drops the counts of another layout, and ignores an unchanged one", () => {
    setEntryPages("ch-1", 5, "novel|6x9|serif|");
    const before = usePageCount.getState();
    setEntryPages("ch-1", 5, "novel|6x9|serif|");
    expect(usePageCount.getState()).toBe(before);
    setEntryPages("ch-1", 6, "modern|5.5x8.5|sans|Inter");
    expect(usePageCount.getState().byId).toEqual({ "ch-1": 6 });
  });
});

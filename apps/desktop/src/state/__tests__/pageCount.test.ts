import { beforeEach, describe, expect, it } from "vitest";
import { setPageCount, usePageCount } from "../pageCount";

beforeEach(() => setPageCount(0, 1));

describe("page count", () => {
  it("holds the chapter's page count and the cursor's page", () => {
    setPageCount(12, 3);
    expect(usePageCount.getState()).toEqual({ count: 12, current: 3 });
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
    expect(usePageCount.getState()).toEqual({ count: 0, current: 1 });
  });
  it("does not change state for the same values", () => {
    setPageCount(4, 2);
    const before = usePageCount.getState();
    setPageCount(4, 2);
    expect(usePageCount.getState()).toBe(before);
  });
});

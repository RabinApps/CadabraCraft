import { describe, expect, it } from "vitest";
import { setReadingPosition, useReadingPosition } from "../readingPosition";

describe("reading position", () => {
  it("holds the chapter and page at the reading line, and ignores an unchanged position", () => {
    setReadingPosition("ch-2", 14);
    const first = useReadingPosition.getState();
    expect(first).toEqual({ id: "ch-2", page: 14 });
    setReadingPosition("ch-2", 14);
    expect(useReadingPosition.getState()).toBe(first);
    setReadingPosition(null, null);
    expect(useReadingPosition.getState()).toEqual({ id: null, page: null });
  });
});

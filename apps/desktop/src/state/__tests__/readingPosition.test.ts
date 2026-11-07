import { describe, expect, it } from "vitest";
import { setReadingPosition, useReadingPosition } from "../view/readingPosition";

describe("reading position", () => {
  it("holds the chapter and the printed page at the reading line, and ignores an unchanged position", () => {
    setReadingPosition("ch-2", "xiv");
    const first = useReadingPosition.getState();
    expect(first).toEqual({ id: "ch-2", page: "xiv" });
    setReadingPosition("ch-2", "xiv");
    expect(useReadingPosition.getState()).toBe(first);
    setReadingPosition(null, null);
    expect(useReadingPosition.getState()).toEqual({ id: null, page: null });
  });
});

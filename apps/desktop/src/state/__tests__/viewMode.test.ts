import { describe, expect, it } from "vitest";
import { useViewMode } from "../viewMode";

describe("view mode", () => {
  it("starts in write mode and switches", () => {
    expect(useViewMode.getState().mode).toBe("write");
    useViewMode.getState().setMode("read");
    expect(useViewMode.getState().mode).toBe("read");
    useViewMode.getState().setMode("write");
  });
});

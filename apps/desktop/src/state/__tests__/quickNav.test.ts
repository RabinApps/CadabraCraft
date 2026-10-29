import { afterEach, describe, expect, it } from "vitest";
import { useQuickNav } from "../quickNav";

describe("quick navigation state", () => {
  afterEach(() => useQuickNav.getState().close());

  it("starts closed, shows one panel at a time and closes", () => {
    expect(useQuickNav.getState().panel).toBeNull();
    useQuickNav.getState().show("palette");
    expect(useQuickNav.getState().panel).toBe("palette");
    useQuickNav.getState().show("outline");
    expect(useQuickNav.getState().panel).toBe("outline");
    useQuickNav.getState().close();
    expect(useQuickNav.getState().panel).toBeNull();
  });
});

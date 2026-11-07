import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_DROP_ATTR, overEditor } from "../fileDrop";

/** A page that answers hit tests: `inside` elements are in the editor, `outside` ones are not. */
const page = (hit: (x: number) => "inside" | "outside" | null) => {
  const el = (inside: boolean) => ({
    closest: (sel: string) => (inside && sel === `[${EDITOR_DROP_ATTR}]` ? {} : null),
  });
  vi.stubGlobal("document", {
    elementFromPoint: (x: number) => {
      const h = hit(x);
      return h && el(h === "inside");
    },
  });
};

afterEach(() => vi.unstubAllGlobals());

describe("overEditor", () => {
  it("is false without a position", () => {
    expect(overEditor(undefined)).toBe(false);
  });

  it("is false where there is no page or it cannot hit-test", () => {
    expect(overEditor({ x: 5, y: 5 })).toBe(false);
    vi.stubGlobal("document", {});
    expect(overEditor({ x: 5, y: 5 })).toBe(false);
  });

  it("is true over the editor and anything inside it, false elsewhere", () => {
    page((x) => (x === 1 ? "inside" : x === 2 ? "outside" : null));
    expect(overEditor({ x: 1, y: 0 })).toBe(true);
    expect(overEditor({ x: 2, y: 0 })).toBe(false);
    expect(overEditor({ x: 3, y: 0 })).toBe(false);
  });
});

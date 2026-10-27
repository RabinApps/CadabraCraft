import { describe, expect, it } from "vitest";
import { countLabel, prefillQuery } from "./findHelpers";

describe("prefillQuery", () => {
  it("takes a short single-line selection as is", () => {
    expect(prefillQuery("dragon")).toBe("dragon");
    expect(prefillQuery("two words")).toBe("two words");
  });
  it("ignores empty, blank, multi-line and long selections", () => {
    expect(prefillQuery("")).toBeNull();
    expect(prefillQuery("   ")).toBeNull();
    expect(prefillQuery("one\ntwo")).toBeNull();
    expect(prefillQuery("x".repeat(99))).toBe("x".repeat(99));
    expect(prefillQuery("x".repeat(100))).toBeNull();
  });
});

describe("countLabel", () => {
  it("says which match of how many", () => expect(countLabel("a", 12, 3)).toBe("3 of 12"));
  it("says No results only for a non-empty query", () => {
    expect(countLabel("zzz", 0, 0)).toBe("No results");
    expect(countLabel("", 0, 0)).toBe("");
  });
});

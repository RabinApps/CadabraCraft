import { describe, expect, it } from "vitest";
import { cx } from "../cx";

describe("cx", () => {
  it("joins the class names and skips falsy parts", () => {
    expect(cx("a", false, null, undefined, "", "b")).toBe("a b");
    expect(cx()).toBe("");
  });
});

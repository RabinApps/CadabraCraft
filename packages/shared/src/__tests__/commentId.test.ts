import { describe, expect, it } from "vitest";
import { isValidCommentId } from "../ids";

describe("isValidCommentId", () => {
  it("accepts a letter followed by letters, digits, _ or -", () => {
    expect(isValidCommentId("t-1")).toBe(true);
    expect(isValidCommentId("Thread_2")).toBe(true);
    expect(isValidCommentId("a")).toBe(true);
    expect(isValidCommentId("a" + "b".repeat(63))).toBe(true);
  });
  it("refuses anything a page id would refuse, and non-strings", () => {
    for (const bad of ["", "1t", "-t", "t 1", "t/1", "a" + "b".repeat(64)])
      expect(isValidCommentId(bad)).toBe(false);
    for (const bad of [1, null, undefined, {}, [], true]) expect(isValidCommentId(bad)).toBe(false);
  });
});

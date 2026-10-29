import { afterEach, describe, expect, it, vi } from "vitest";
import { jumpToHeading, registerHeadingJump } from "../headingJump";

describe("headingJump", () => {
  afterEach(() => {
    // Nothing is left registered between tests.
    expect(jumpToHeading(0)).toBe(false);
  });

  it("does nothing while no editor is registered", () => {
    expect(jumpToHeading(3)).toBe(false);
  });

  it("calls the registered function and returns its answer", () => {
    const jump = vi.fn((i: number) => i === 2);
    const off = registerHeadingJump(jump);
    expect(jumpToHeading(2)).toBe(true);
    expect(jumpToHeading(5)).toBe(false);
    expect(jump).toHaveBeenCalledWith(5);
    off();
  });

  it("removes only its own registration", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const offFirst = registerHeadingJump(first);
    const offSecond = registerHeadingJump(second);
    // The first editor unmounts after the second one mounted (a chapter switch): the second stays.
    offFirst();
    expect(jumpToHeading(0)).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    offSecond();
  });
});

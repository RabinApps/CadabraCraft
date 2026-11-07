import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { moveInToolbar } from "../toolbar/toolbarKeys";

type FakeButton = { focus: ReturnType<typeof vi.fn> };

const key = (k: string) =>
  ({ key: k, preventDefault: vi.fn() }) as unknown as KeyboardEvent<HTMLElement>;

let buttons: FakeButton[] = [];

/** A bar whose enabled buttons are `count` fakes, with the focus on `focusAt`. */
function barOf(count: number, focusAt = 0, direction: "ltr" | "rtl" = "ltr") {
  buttons = Array.from({ length: count }, () => ({ focus: vi.fn() }));
  vi.stubGlobal("document", { activeElement: buttons[focusAt] });
  vi.stubGlobal("getComputedStyle", () => ({ direction }));
  return { querySelectorAll: () => buttons } as unknown as HTMLElement;
}

const focused = () => buttons.findIndex((b) => b.focus.mock.calls.length > 0);
const focuses = () => buttons.reduce((n, b) => n + b.focus.mock.calls.length, 0);

afterEach(() => vi.unstubAllGlobals());

describe("moveInToolbar", () => {
  it("does nothing without a bar", () => {
    const e = key("ArrowRight");
    expect(() => moveInToolbar(e, null)).not.toThrow();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores keys the toolbar does not answer to", () => {
    const bar = barOf(3, 1);
    const e = key("a");
    moveInToolbar(e, bar);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(focuses()).toBe(0);
  });

  it("does nothing when the focus is not on one of its buttons", () => {
    const bar = barOf(3);
    vi.stubGlobal("document", { activeElement: {} });
    const e = key("ArrowRight");
    moveInToolbar(e, bar);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(focuses()).toBe(0);
  });

  it("moves with the arrows and wraps at both ends", () => {
    let e = key("ArrowRight");
    moveInToolbar(e, barOf(3, 0));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(focused()).toBe(1);

    e = key("ArrowRight");
    moveInToolbar(e, barOf(3, 2));
    expect(focused()).toBe(0);

    e = key("ArrowLeft");
    moveInToolbar(e, barOf(3, 0));
    expect(focused()).toBe(2);

    e = key("ArrowLeft");
    moveInToolbar(e, barOf(3, 2));
    expect(focused()).toBe(1);
  });

  it("sends Home and End to the first and last button", () => {
    let e = key("Home");
    moveInToolbar(e, barOf(4, 2));
    expect(focused()).toBe(0);

    e = key("End");
    moveInToolbar(e, barOf(4, 1));
    expect(focused()).toBe(3);
  });

  it("swaps the arrows in a right-to-left bar", () => {
    let e = key("ArrowRight");
    moveInToolbar(e, barOf(3, 1, "rtl"));
    expect(focused()).toBe(0);

    e = key("ArrowLeft");
    moveInToolbar(e, barOf(3, 1, "rtl"));
    expect(focused()).toBe(2);
  });

  it("copes with a single button", () => {
    const e = key("ArrowRight");
    moveInToolbar(e, barOf(1));
    expect(focused()).toBe(0);
  });
});

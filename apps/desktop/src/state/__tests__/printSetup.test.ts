import { beforeEach, describe, expect, it } from "vitest";
import { bleedInches, setBleed, setCropMarks, usePrintSetup } from "../printSetup";

beforeEach(() => usePrintSetup.setState({ bleed: false, cropMarks: false }));

describe("printSetup", () => {
  it("starts with neither", () => {
    expect(usePrintSetup.getState()).toEqual({ bleed: false, cropMarks: false });
  });
  it("crop marks turn the bleed on", () => {
    setCropMarks(true);
    expect(usePrintSetup.getState()).toEqual({ bleed: true, cropMarks: true });
  });
  it("turning the bleed off turns the crop marks off", () => {
    setCropMarks(true);
    setBleed(false);
    expect(usePrintSetup.getState()).toEqual({ bleed: false, cropMarks: false });
  });
  it("keeps the crop marks when the bleed stays on, and the bleed when only the marks go", () => {
    setCropMarks(true);
    setBleed(true);
    expect(usePrintSetup.getState().cropMarks).toBe(true);
    setCropMarks(false);
    expect(usePrintSetup.getState()).toEqual({ bleed: true, cropMarks: false });
  });
  it("maps the bleed to KDP's 0.125 in", () => {
    expect(bleedInches(true)).toBe(0.125);
    expect(bleedInches(false)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  loudnessPasses,
  loudnessScope,
  loudnessView,
  summarizeLoudness,
} from "../audio/loudnessReport";

const measured = (integratedLufs: number, truePeakDbtp: number) => ({
  integratedLufs,
  truePeakDbtp,
  targetLufs: -19,
  passed: false,
});

describe("loudnessPasses", () => {
  it("passes within 1 LU of -19 LUFS with the peak at or below -3 dBTP", () => {
    expect(loudnessPasses(measured(-19.2, -3.4))).toBe(true);
    expect(loudnessPasses(measured(-18, -3))).toBe(true);
    expect(loudnessPasses(measured(-20, -3))).toBe(true);
  });

  it("fails when the integrated loudness is more than 1 LU from the target", () => {
    expect(loudnessPasses(measured(-17.9, -6))).toBe(false);
    expect(loudnessPasses(measured(-20.1, -6))).toBe(false);
  });

  it("fails when the true peak is above -3 dBTP", () => {
    expect(loudnessPasses(measured(-19, -2.9))).toBe(false);
  });

  it("judges the one-decimal values the card shows, so the verdict matches the numbers", () => {
    // Shown as -3.0 dBTP, so it passes; -3.04 rounds to -3.0 as well.
    expect(loudnessPasses(measured(-19, -3.04))).toBe(true);
  });
});

describe("loudnessView", () => {
  it("maps the report to the three value rows, one decimal for the measured values", () => {
    const view = loudnessView({ ...measured(-19.23, -3.44), chapters: 2 });
    expect(view.rows).toEqual([
      { label: "Integrated loudness", value: "-19.2 LUFS" },
      { label: "True peak", value: "-3.4 dBTP" },
      { label: "Target", value: "-19 LUFS" },
    ]);
    expect(view.chapters).toBe(2);
  });

  it("gives the plain-words pass verdict", () => {
    const view = loudnessView({ ...measured(-19, -6), chapters: 1 });
    expect(view.passed).toBe(true);
    expect(view.verdict).toBe("Within the retail target");
  });

  it("names the peak first when the peak is too high", () => {
    const view = loudnessView({ ...measured(-25, -1), chapters: 1 });
    expect(view.passed).toBe(false);
    expect(view.verdict).toBe("Above -3 dBTP: lower the peak");
  });

  it("says the loudness is outside the target when only the loudness fails", () => {
    const view = loudnessView({ ...measured(-14, -6), chapters: 1 });
    expect(view.passed).toBe(false);
    expect(view.verdict).toBe("Outside the retail target: adjust the source");
  });
});

describe("loudnessScope", () => {
  it("names the chapter count in the singular and the plural", () => {
    expect(loudnessScope(1)).toBe("Measured on 1 chapter.");
    expect(loudnessScope(3)).toBe(
      "Measured on 3 chapters. Shows the chapter furthest from the target and the highest peak.",
    );
  });
});

describe("summarizeLoudness", () => {
  it("takes the chapter furthest from the target and the highest peak across the book", () => {
    const summary = summarizeLoudness([
      { status: "done", loudness: measured(-19.4, -5) },
      { status: "cached", loudness: measured(-16.5, -3.8) },
      { status: "empty" },
    ]);
    expect(summary).toEqual({
      integratedLufs: -16.5,
      truePeakDbtp: -3.8,
      targetLufs: -19,
      chapters: 2,
    });
  });

  it("is null when a chapter has no report, so an older render shows no card", () => {
    expect(
      summarizeLoudness([{ status: "done", loudness: measured(-19, -5) }, { status: "cached" }]),
    ).toBeNull();
  });

  it("is null when nothing was read", () => {
    expect(summarizeLoudness([{ status: "empty" }])).toBeNull();
    expect(summarizeLoudness([])).toBeNull();
  });
});

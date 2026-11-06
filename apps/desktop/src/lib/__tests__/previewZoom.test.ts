import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PREVIEW_ZOOMS,
  clampZoom,
  fitZoomFor,
  pinchZoom,
  stepZoom,
  touchDistance,
  wheelZoom,
} from "../export/previewZoom";

describe("preview zoom", () => {
  it("steps to the next one above or below, and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(3, 1)).toBeNull();
    expect(stepZoom(0.5, -1)).toBeNull();
    // Between steps (after a pinch or a fit) it goes to the neighbour on that side.
    expect(stepZoom(0.83, 1)).toBe(1);
    expect(stepZoom(0.83, -1)).toBe(0.75);
    expect(stepZoom(0.3, -1)).toBeNull();
    expect(stepZoom(3.7, 1)).toBeNull();
    expect(PREVIEW_ZOOMS[0]).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(PREVIEW_ZOOMS.at(-1)).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("keeps a wheel or pinch zoom within the limits", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(1, 0)).toBe(1);
    expect(wheelZoom(MAX_ZOOM, -1000)).toBe(MAX_ZOOM);
    expect(wheelZoom(MIN_ZOOM, 1000)).toBe(MIN_ZOOM);
  });

  it("follows two fingers by the ratio of their distances", () => {
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 200, 100)).toBe(1);
    expect(pinchZoom(1, 100, 1e6)).toBe(MAX_ZOOM);
    expect(pinchZoom(1.5, 0, 100)).toBe(1.5);
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("fits the paper across to the pane minus the gutter", () => {
    // 11 in of paper at 50 px/in in a 1148 px pane with 48 px of gutter fills it exactly.
    expect(fitZoomFor(1148, 11, 50, 48)).toBeCloseTo(2, 5);
    expect(fitZoomFor(48 + 550, 11, 50, 48)).toBeCloseTo(1, 5);
    expect(fitZoomFor(10, 11, 50, 48)).toBe(MIN_ZOOM);
    expect(fitZoomFor(5000, 5, 50, 48)).toBe(MAX_ZOOM);
    // A pane that is not measured yet.
    expect(fitZoomFor(0, 11, 50, 0)).toBe(1);
    expect(fitZoomFor(100, 0, 50, 0)).toBe(1);
  });
});

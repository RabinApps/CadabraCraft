import { describe, expect, it } from "vitest";
import {
  cleanGoal,
  MAX_SESSION_GOAL,
  cleanSnapshotKeep,
  cleanBookSnapshotKeep,
  cleanBookSnapshotMaxMb,
  BOOK_SNAPSHOT_KEEP_DEFAULT,
  BOOK_SNAPSHOT_KEEP_MAX,
  BOOK_SNAPSHOT_KEEP_MIN,
  BOOK_SNAPSHOT_MAX_MB_DEFAULT,
  BOOK_SNAPSHOT_MAX_MB_MAX,
  BOOK_SNAPSHOT_MAX_MB_MIN,
  SNAPSHOT_KEEP_DEFAULT,
  SNAPSHOT_KEEP_MAX,
  SNAPSHOT_KEEP_MIN,
  cleanRawHtmlPaste,
} from "../view/editorPrefs";

describe("cleanRawHtmlPaste", () => {
  it("keeps the three choices and falls back to ask", () => {
    for (const v of ["ask", "convert", "text"] as const) expect(cleanRawHtmlPaste(v)).toBe(v);
    for (const v of [undefined, null, "", "yes", 1, {}]) expect(cleanRawHtmlPaste(v)).toBe("ask");
  });
});

describe("cleanSnapshotKeep", () => {
  it("keeps whole numbers in range, clamps the rest of the numbers and falls back to the default for non-numbers", () => {
    expect(cleanSnapshotKeep(20)).toBe(20);
    expect(cleanSnapshotKeep(1)).toBe(SNAPSHOT_KEEP_MIN);
    expect(cleanSnapshotKeep(100000)).toBe(SNAPSHOT_KEEP_MAX);
    for (const bad of [NaN, 2.5, "50", null, undefined])
      expect(cleanSnapshotKeep(bad)).toBe(SNAPSHOT_KEEP_DEFAULT);
  });
});

describe("cleanBookSnapshotKeep", () => {
  it("keeps whole numbers from 5 to 200, clamps other numbers and defaults to 50 for non-numbers", () => {
    expect([BOOK_SNAPSHOT_KEEP_MIN, BOOK_SNAPSHOT_KEEP_MAX, BOOK_SNAPSHOT_KEEP_DEFAULT]).toEqual([
      5, 200, 50,
    ]);
    expect(cleanBookSnapshotKeep(20)).toBe(20);
    expect(cleanBookSnapshotKeep(1)).toBe(BOOK_SNAPSHOT_KEEP_MIN);
    expect(cleanBookSnapshotKeep(100000)).toBe(BOOK_SNAPSHOT_KEEP_MAX);
    for (const bad of [NaN, 2.5, "50", null, undefined, Infinity])
      expect(cleanBookSnapshotKeep(bad)).toBe(BOOK_SNAPSHOT_KEEP_DEFAULT);
  });
});

describe("cleanBookSnapshotMaxMb", () => {
  it("keeps whole numbers from 100 to 4096, clamps other numbers and defaults to 1024 for non-numbers", () => {
    expect([
      BOOK_SNAPSHOT_MAX_MB_MIN,
      BOOK_SNAPSHOT_MAX_MB_MAX,
      BOOK_SNAPSHOT_MAX_MB_DEFAULT,
    ]).toEqual([100, 4096, 1024]);
    expect(cleanBookSnapshotMaxMb(500)).toBe(500);
    expect(cleanBookSnapshotMaxMb(1)).toBe(BOOK_SNAPSHOT_MAX_MB_MIN);
    expect(cleanBookSnapshotMaxMb(1e9)).toBe(BOOK_SNAPSHOT_MAX_MB_MAX);
    for (const bad of [NaN, 2.5, "1024", null, undefined, -Infinity])
      expect(cleanBookSnapshotMaxMb(bad)).toBe(BOOK_SNAPSHOT_MAX_MB_DEFAULT);
  });
});

describe("cleanGoal", () => {
  it("keeps whole numbers up to the maximum and turns everything else into off", () => {
    expect(cleanGoal(500)).toBe(500);
    expect(cleanGoal(0)).toBe(0);
    expect(cleanGoal(MAX_SESSION_GOAL + 1)).toBe(MAX_SESSION_GOAL);
    for (const bad of [-1, 2.5, NaN, "5", null, undefined]) expect(cleanGoal(bad)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  cleanSnapshotKeep,
  SNAPSHOT_KEEP_DEFAULT,
  SNAPSHOT_KEEP_MAX,
  SNAPSHOT_KEEP_MIN,
  cleanRawHtmlPaste,
} from "../editorPrefs";

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

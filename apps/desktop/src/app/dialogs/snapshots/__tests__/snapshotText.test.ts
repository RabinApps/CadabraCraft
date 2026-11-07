import { describe, expect, it } from "vitest";
import type { BookSnapshotEntry } from "../../../../lib/bridge";
import { formatSize, limitsOf, nameProblem, pruneNotice, summaryLine } from "../snapshotText";

const entry = (bytes: number): BookSnapshotEntry => ({
  path: `.cadabra/snapshots/${bytes}.json`,
  at: "20261028-1000",
  name: "n",
  automatic: false,
  pinned: false,
  pages: [],
  assets: 0,
  bytes,
});

describe("formatSize", () => {
  it("uses KB under a megabyte, whole MB up to a gigabyte, and GB with one decimal", () => {
    expect(formatSize(10, "en")).toBe("1 KB");
    expect(formatSize(2048, "en")).toBe("2 KB");
    expect(formatSize(340 * 1024 * 1024, "en")).toBe("340 MB");
    expect(formatSize(1.25 * 1024 * 1024 * 1024, "en")).toBe("1.3 GB");
  });
  it("falls back to the default locale for one that does not exist", () => {
    expect(formatSize(5 * 1024 * 1024, "pseudo-not-real-xx-")).toBe("5 MB");
  });
});

describe("summaryLine", () => {
  it("counts the snapshots and adds their sizes", () => {
    const mb = 1024 * 1024;
    expect(summaryLine([entry(100 * mb), entry(240 * mb)], "en")).toBe("2 snapshots · 340 MB");
    expect(summaryLine([entry(mb)], "en")).toBe("1 snapshot · 1 MB");
    expect(summaryLine([], "en")).toBe("0 snapshots · 1 KB");
  });
});

describe("limitsOf", () => {
  it("maps the preferences to what Rust takes", () => {
    expect(limitsOf({ bookSnapshotKeep: 20, bookSnapshotMaxMb: 500 })).toEqual({
      maxCount: 20,
      maxMb: 500,
    });
  });
});

describe("pruneNotice", () => {
  it("says nothing when nothing moved", () => {
    expect(pruneNotice({ moved: 0, pinned_moved: [] })).toBeNull();
  });
  it("counts older snapshots, singular and plural", () => {
    expect(pruneNotice({ moved: 1, pinned_moved: [] })).toEqual({
      older: "1 older snapshot moved to .cadabra/trash",
      pinned: null,
    });
    expect(pruneNotice({ moved: 3, pinned_moved: [] })?.older).toBe(
      "3 older snapshots moved to .cadabra/trash",
    );
  });
  it("warns separately when pinned ones moved, and counts only the unpinned as older", () => {
    const n = pruneNotice({ moved: 3, pinned_moved: ["a", "b"] });
    expect(n?.older).toBe("1 older snapshot moved to .cadabra/trash");
    expect(n?.pinned).toContain("2 pinned snapshots moved to .cadabra/trash too");
    const only = pruneNotice({ moved: 1, pinned_moved: ["a"] });
    expect(only?.older).toBeNull();
    expect(only?.pinned).toContain("1 pinned snapshot moved");
  });
});

describe("nameProblem", () => {
  it("refuses an empty or blank name", () => {
    expect(nameProblem("")).toContain("no name");
    expect(nameProblem("   ")).toContain("no name");
    expect(nameProblem("Before")).toBeNull();
  });
});

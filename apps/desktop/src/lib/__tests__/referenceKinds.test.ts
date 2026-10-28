import { describe, expect, it } from "vitest";
import type { Reference } from "@cadabracraft/format";
import {
  NO_FILTER,
  canReorder,
  dropPosition,
  insertionIndex,
  allTags,
  filterReferences,
  formatSize,
  referenceKind,
  referenceMediaType,
} from "../referenceKinds";

const ref = (over: Partial<Reference>): Reference => ({
  id: "ref-1",
  file: "references/a.pdf",
  title: "A",
  note: "",
  tags: [],
  chapters: [],
  addedAt: "2026-10-28T09:30:00.000Z",
  ...over,
});

describe("kinds and media types", () => {
  it.each([
    ["references/a.PNG", "image", "image/png"],
    ["references/v.svg", "image", "image/svg+xml"],
    ["references/v.mov", "video", "video/quicktime"],
    ["references/v.m4v", "video", "video/mp4"],
    ["references/s.flac", "audio", "audio/flac"],
    ["references/b.pdf", "pdf", "application/pdf"],
    ["references/n.markdown", "text", "text/markdown"],
    ["references/d.xlsx", "other", "application/octet-stream"],
    ["references/noext", "other", "application/octet-stream"],
    ["references.d/noext", "other", "application/octet-stream"],
  ])("%s is %s", (file, kind, type) => {
    expect(referenceKind(file)).toBe(kind);
    expect(referenceMediaType(file)).toBe(type);
  });
});

describe("formatSize", () => {
  it.each([
    [0, "0 B"],
    [812, "812 B"],
    [1024, "1 KB"],
    [12 * 1024, "12 KB"],
    [3.2 * 1024 ** 2, "3.2 MB"],
    [48 * 1024 ** 2, "48 MB"],
    [1.44 * 1024 ** 3, "1.4 GB"],
    [20 * 1024 ** 3, "20 GB"],
  ])("%d is %s", (n, text) => expect(formatSize(n)).toBe(text));
});

describe("filterReferences and allTags", () => {
  const list = [
    ref({
      id: "ref-1",
      file: "references/lighthouse.pdf",
      title: "Lighthouse history",
      tags: ["history", "1893"],
    }),
    ref({
      id: "ref-2",
      file: "references/dusk.mp4",
      title: "Harbour",
      note: "Gulls and light",
      tags: ["harbour"],
    }),
    ref({ id: "ref-3", file: "references/map.png", title: "Map", tags: ["history"] }),
  ];
  const ids = (f: Partial<typeof NO_FILTER>) =>
    filterReferences(list, { ...NO_FILTER, ...f }).map((r) => r.id);
  it("keeps everything without a filter", () =>
    expect(ids({})).toEqual(["ref-1", "ref-2", "ref-3"]));
  it("searches title, note, tags and file name, ignoring case and spaces around", () => {
    expect(ids({ query: " LIGHT " })).toEqual(["ref-1", "ref-2"]);
    expect(ids({ query: "gulls" })).toEqual(["ref-2"]);
    expect(ids({ query: "1893" })).toEqual(["ref-1"]);
    expect(ids({ query: "dusk.mp4" })).toEqual(["ref-2"]);
    expect(ids({ query: "nothing" })).toEqual([]);
  });
  it("filters by kind and tag together", () => {
    expect(ids({ kind: "video" })).toEqual(["ref-2"]);
    expect(ids({ tag: "history" })).toEqual(["ref-1", "ref-3"]);
    expect(ids({ tag: "history", kind: "image" })).toEqual(["ref-3"]);
  });
  it("lists tags once, alphabetically", () =>
    expect(allTags(list)).toEqual(["1893", "harbour", "history"]));
});

describe("reordering helpers", () => {
  it("canReorder is true only with no search, type or tag filter", () => {
    expect(canReorder(NO_FILTER)).toBe(true);
    expect(canReorder({ ...NO_FILTER, query: " " })).toBe(true);
    expect(canReorder({ ...NO_FILTER, query: "x" })).toBe(false);
    expect(canReorder({ ...NO_FILTER, kind: "pdf" })).toBe(false);
    expect(canReorder({ ...NO_FILTER, tag: "history" })).toBe(false);
  });
  it("insertionIndex counts the rows above the pointer", () => {
    expect(insertionIndex([10, 30, 50], 0)).toBe(0);
    expect(insertionIndex([10, 30, 50], 35)).toBe(2);
    expect(insertionIndex([10, 30, 50], 99)).toBe(3);
    expect(insertionIndex([], 5)).toBe(0);
  });
  it("dropPosition accounts for the dragged row leaving its place", () => {
    expect(dropPosition(1, 0)).toBe(0);
    expect(dropPosition(1, 1)).toBe(1);
    expect(dropPosition(1, 2)).toBe(1);
    expect(dropPosition(1, 3)).toBe(2);
  });
});

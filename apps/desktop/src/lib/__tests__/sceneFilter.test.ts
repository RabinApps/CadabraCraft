import { describe, expect, it } from "vitest";
import { buildBoard } from "../scenes/boardData";
import {
  boardRows,
  emptyFilter,
  facetKey,
  facetsOf,
  filterBoard,
  filterTimeline,
  isFiltering,
  labelColour,
  matchScene,
  type SceneFilter,
} from "../scenes/sceneFilter";
import type { SceneRow } from "../scenes/scenes";
import { buildTimeline } from "../scenes/timelineData";

const row = (id: string, over: Partial<SceneRow> = {}): SceneRow => ({
  id,
  title: id.toUpperCase(),
  status: "",
  pov: "",
  label: "",
  synopsis: "",
  target: null,
  date: "",
  cast: [],
  words: 0,
  ...over,
});
const f = (over: Partial<SceneFilter>): SceneFilter => ({ ...emptyFilter, ...over });
const book = (...chapters: SceneRow[][]) =>
  buildBoard(
    chapters.map((_, i) => ({ id: `c${i}` })),
    new Map(chapters.map((_, i) => [`c${i}`, `Chapter ${i}`])),
    Object.fromEntries(chapters.map((rows, i) => [`c${i}`, { rows, unsorted: 7 }])),
  );

describe("facetsOf", () => {
  it("counts values case-insensitively, shows the first spelling, sorts and puts none last", () => {
    const facets = facetsOf([
      row("a", { pov: "Mara", label: "Flashback", status: "draft" }),
      row("b", { pov: " mara ", label: "", status: "final" }),
      row("c", { pov: "Ada", label: "flashback", status: "draft" }),
      row("d", { pov: "", status: "" }),
    ]);
    expect(facets.pov).toEqual([
      { key: "ada", text: "Ada", count: 1 },
      { key: "mara", text: "Mara", count: 2 },
      { key: "", text: "", count: 1 },
    ]);
    expect(facets.label.map((v) => [v.key, v.text, v.count])).toEqual([
      ["flashback", "Flashback", 2],
      ["", "", 2],
    ]);
    expect(facets.status.map((v) => [v.key, v.count])).toEqual([
      ["draft", 2],
      ["final", 1],
      ["", 1],
    ]);
  });

  it("is empty for no scenes", () => {
    expect(facetsOf([])).toEqual({ pov: [], status: [], label: [] });
  });
});

describe("matchScene", () => {
  const a = row("a", { pov: "Mara", status: "draft", label: "Past", synopsis: "A storm at sea" });
  it("matches everything with an empty filter", () => {
    expect(isFiltering(emptyFilter)).toBe(false);
    expect(isFiltering(f({ query: "  " }))).toBe(false);
    expect(matchScene(a, emptyFilter)).toBe(true);
  });
  it("is OR within a facet and AND across facets", () => {
    expect(matchScene(a, f({ pov: ["ada", "mara"] }))).toBe(true);
    expect(matchScene(a, f({ pov: ["ada"] }))).toBe(false);
    expect(matchScene(a, f({ pov: ["mara"], status: ["draft", "final"] }))).toBe(true);
    expect(matchScene(a, f({ pov: ["mara"], status: ["final"] }))).toBe(false);
    expect(matchScene(a, f({ label: ["past"], status: ["draft"], pov: ["mara"] }))).toBe(true);
    expect(matchScene(a, f({ label: ["future"] }))).toBe(false);
  });
  it("matches the none pseudo-value", () => {
    expect(matchScene(row("x"), f({ pov: [""] }))).toBe(true);
    expect(matchScene(row("x", { label: "  " }), f({ label: [""] }))).toBe(true);
    expect(matchScene(row("x", { status: "" }), f({ status: [""] }))).toBe(true);
    expect(matchScene(a, f({ pov: [""] }))).toBe(false);
  });
  it("matches the query fuzzily on the title and the synopsis", () => {
    expect(isFiltering(f({ query: "x" }))).toBe(true);
    expect(matchScene(a, f({ query: "stm" }))).toBe(true);
    expect(matchScene(a, f({ query: "a" }))).toBe(true);
    expect(matchScene(a, f({ query: "zzz" }))).toBe(false);
    expect(matchScene(row("q", { title: "Quay" }), f({ query: "qy" }))).toBe(true);
  });
  it("has one key for two spellings", () => {
    expect(facetKey("  MARA ")).toBe("mara");
  });
});

describe("filterBoard", () => {
  const b = book(
    [row("a", { pov: "Mara" }), row("b", { pov: "Ada" })],
    [row("c", { pov: "mara" })],
  );
  it("returns the board itself when nothing is on", () => {
    expect(filterBoard(b, emptyFilter)).toBe(b);
  });
  it("hides rows without changing the others, their order or the unsorted words", () => {
    const out = filterBoard(b, f({ pov: ["mara"] }));
    expect(out.chapters.map((c) => c.rows.map((r) => r.id))).toEqual([["a"], ["c"]]);
    expect(out.chapters.map((c) => c.unsortedWords)).toEqual([7, 7]);
    expect(boardRows(b).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(b.chapters[0]!.rows).toHaveLength(2);
  });
  it("keeps an emptied chapter", () => {
    const out = filterBoard(b, f({ pov: ["ada"] }));
    expect(out.chapters.map((c) => c.rows.length)).toEqual([1, 0]);
  });
});

describe("filterTimeline", () => {
  it("filters after the axis is built, so the undated rule is unchanged", () => {
    const b = book([
      row("a", { date: "1893-09-03", pov: "Mara" }),
      row("b", { pov: "Ada" }),
      row("c", { pov: "Mara", date: "1893-09-02" }),
    ]);
    const items = buildTimeline(b, "story");
    expect(filterTimeline(items, emptyFilter)).toBe(items);
    const out = filterTimeline(items, f({ pov: ["ada"] }));
    expect(out.map((i) => i.scene.id)).toEqual(["b"]);
    // B still follows A, although A is hidden.
    expect(out[0]!.follows).toBe("A");
  });
});

describe("labelColour", () => {
  it("has no colour without a label", () => {
    expect(labelColour("")).toBeNull();
    expect(labelColour("  ")).toBeNull();
  });
  it("is stable, ignores case and spacing, and uses the existing tokens only", () => {
    expect(labelColour("Flashback")).toBe(labelColour(" flashback "));
    const seen = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "Past", "Future", "Dream", "Plot"].map((l) =>
        labelColour(l),
      ),
    );
    for (const c of seen) expect(["accent", "warn", "success"]).toContain(c);
    expect(seen.size).toBeGreaterThan(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProject } from "../project/index";
import {
  MAX_BOOKS,
  MAX_VALUES,
  parseSaved,
  resetSceneFilter,
  useSceneFilter,
  withView,
} from "../view/sceneFilter";
import { emptyFilter } from "../../lib/scenes/sceneFilter";

const KEY = "cadabracraft.sceneFilters";
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  resetSceneFilter("/book");
});
afterEach(() => {
  vi.unstubAllGlobals();
  useProject.setState({ root: null });
  resetSceneFilter(null);
});

const stored = () => JSON.parse(data.get(KEY) ?? "{}") as Record<string, unknown>;

describe("parseSaved", () => {
  it("never throws and ignores a value of the wrong shape", () => {
    expect(parseSaved(null)).toEqual({});
    expect(parseSaved([])).toEqual({});
    expect(parseSaved("x")).toEqual({});
    expect(parseSaved({ "/a": null, "/b": { at: "x" }, "/c": 5 })).toEqual({});
  });
  it("keeps good values, drops unknown statuses and bad types, and defaults the rest", () => {
    const out = parseSaved({
      "/a": {
        at: 3,
        colourBy: "label",
        filter: {
          pov: ["mara", 4, "mara"],
          status: ["draft", "bogus", ""],
          label: "x",
          query: "q",
        },
      },
      "/b": { at: 1, colourBy: "rainbow", filter: "nope" },
    });
    expect(out["/a"]).toEqual({
      at: 3,
      colourBy: "label",
      filter: { pov: ["mara"], status: ["draft", ""], label: [], query: "q" },
    });
    expect(out["/b"]).toEqual({ at: 1, colourBy: "none", filter: emptyFilter });
  });
  it("caps the values and the text, and keeps the newest books", () => {
    const many = Array.from({ length: MAX_VALUES + 20 }, (_, i) => `v${i}`);
    const out = parseSaved({
      "/a": { at: 1, colourBy: "none", filter: { pov: many, query: "x".repeat(500) } },
    });
    expect(out["/a"]!.filter.pov).toHaveLength(MAX_VALUES);
    expect(out["/a"]!.filter.query).toHaveLength(200);
    let saved = {};
    for (let i = 0; i < MAX_BOOKS + 5; i++)
      saved = withView(saved, `/b${i}`, { filter: emptyFilter, colourBy: "none", at: i });
    expect(Object.keys(saved)).toHaveLength(MAX_BOOKS);
    expect(saved).not.toHaveProperty("/b0");
    expect(saved).toHaveProperty(`/b${MAX_BOOKS + 4}`);
  });
});

describe("the scene filter store", () => {
  it("toggles values, clears a facet, sets the query and clears everything", () => {
    const s = () => useSceneFilter.getState();
    s().toggle("pov", "mara");
    s().toggle("pov", "ada");
    s().toggle("pov", "mara");
    s().toggle("status", "draft");
    s().toggle("label", "");
    s().setQuery("storm");
    expect(s().filter).toEqual({ pov: ["ada"], status: ["draft"], label: [""], query: "storm" });
    s().clearFacet("status");
    expect(s().filter.status).toEqual([]);
    s().clear();
    expect(s().filter).toEqual(emptyFilter);
  });

  it("remembers the filter and the colour per book and loads them again", () => {
    useSceneFilter.getState().toggle("pov", "mara");
    useSceneFilter.getState().setColourBy("status");
    expect(stored()["/book"]).toMatchObject({ colourBy: "status", filter: { pov: ["mara"] } });
    resetSceneFilter("/other");
    expect(useSceneFilter.getState().filter).toEqual(emptyFilter);
    useSceneFilter.getState().setColourBy("label");
    // Forget memory and read it back from storage.
    resetSceneFilter("/book");
    expect(useSceneFilter.getState().filter.pov).toEqual(["mara"]);
    expect(useSceneFilter.getState().colourBy).toBe("status");
    resetSceneFilter("/other");
    expect(useSceneFilter.getState().colourBy).toBe("label");
  });

  it("follows the open book", () => {
    useSceneFilter.getState().toggle("label", "past");
    useProject.setState({ root: "/second" });
    expect(useSceneFilter.getState().root).toBe("/second");
    expect(useSceneFilter.getState().filter).toEqual(emptyFilter);
    useProject.setState({ root: "/book" });
    expect(useSceneFilter.getState().filter.label).toEqual(["past"]);
    useProject.setState({ root: "/book", notice: "x" } as never);
    expect(useSceneFilter.getState().root).toBe("/book");
  });

  it("keeps working in memory without a book or without storage", () => {
    resetSceneFilter(null);
    useSceneFilter.getState().toggle("pov", "x");
    expect(useSceneFilter.getState().filter.pov).toEqual(["x"]);
    expect(data.size).toBe(0);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    resetSceneFilter("/book");
    useSceneFilter.getState().toggle("pov", "y");
    expect(useSceneFilter.getState().filter.pov).toEqual(["y"]);
  });
});

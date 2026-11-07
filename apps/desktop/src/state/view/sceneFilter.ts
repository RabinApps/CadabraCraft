import { create } from "zustand";
import { SCENE_STATUSES } from "@cadabracraft/editor-schema";
import { readStoredJson, writeStored } from "../../lib/persisted";
import {
  emptyFilter,
  type ColourBy,
  type FacetName,
  type SceneFilter,
} from "../../lib/scenes/sceneFilter";
import type { SceneStatus } from "../../lib/scenes/scenes";
import { useProject } from "../project/index";

/**
 * The scene filter and the "Colour by" choice, shared by the Scene board and the Timeline and remembered for each book in the
 * app preferences (localStorage, never in the project files). The key is the book's folder, as the reading positions have it.
 */
const KEY = "cadabracraft.sceneFilters";
/** Books remembered; the least recently changed ones are forgotten. */
export const MAX_BOOKS = 50;
/** Values kept per facet, and characters kept of a value or the query, so a damaged entry cannot grow without bound. */
export const MAX_VALUES = 100;
const MAX_TEXT = 200;

export interface SavedView {
  filter: SceneFilter;
  colourBy: ColourBy;
  at: number;
}
type Saved = Record<string, SavedView>;

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, MAX_TEXT)),
        ),
      ].slice(0, MAX_VALUES)
    : [];

const COLOUR_BY: string[] = ["none", "label", "status"];
const STATUSES: string[] = ["", ...SCENE_STATUSES];

/** Tolerant parse of the stored value: drops malformed entries and keeps at most `MAX_BOOKS`, newest first. Never throws. */
export function parseSaved(v: unknown): Saved {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const entries: [string, SavedView][] = [];
  for (const [root, e] of Object.entries(v)) {
    const p = e as { filter?: unknown; colourBy?: unknown; at?: unknown } | null;
    if (!p || typeof p !== "object" || typeof p.at !== "number" || !Number.isFinite(p.at)) continue;
    const f = (p.filter && typeof p.filter === "object" ? p.filter : {}) as Record<string, unknown>;
    entries.push([
      root,
      {
        filter: {
          pov: strings(f.pov),
          label: strings(f.label),
          status: strings(f.status).filter((s): s is SceneStatus => STATUSES.includes(s)),
          query: typeof f.query === "string" ? f.query.slice(0, MAX_TEXT) : "",
        },
        colourBy: COLOUR_BY.includes(p.colourBy as string) ? (p.colourBy as ColourBy) : "none",
        at: p.at,
      },
    ]);
  }
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_BOOKS));
}

/** `saved` with the view of `root` set, forgetting the oldest book beyond the cap. */
export const withView = (saved: Saved, root: string, view: SavedView): Saved =>
  parseSaved({ ...saved, [root]: view });

let cache: Saved | null = null;
const all = (): Saved => (cache ??= parseSaved(readStoredJson(KEY)));

interface SceneFilterState {
  /** The book the filter below belongs to. */
  root: string | null;
  filter: SceneFilter;
  colourBy: ColourBy;
  /** Switches one value of a facet on or off (`pov` and `label` take facet keys). */
  toggle: (facet: FacetName, value: string) => void;
  clearFacet: (facet: FacetName) => void;
  setQuery: (query: string) => void;
  clear: () => void;
  setColourBy: (by: ColourBy) => void;
}

type View = { filter: SceneFilter; colourBy: ColourBy };

const viewOf = (root: string | null): View => {
  const saved = root ? all()[root] : undefined;
  return saved
    ? { filter: saved.filter, colourBy: saved.colourBy }
    : { filter: emptyFilter, colourBy: "none" };
};

export const useSceneFilter = create<SceneFilterState>((set, get) => {
  /** Applies a change and remembers it for the open book. */
  const apply = (next: Partial<View>) => {
    const view = { filter: get().filter, colourBy: get().colourBy, ...next };
    set(view);
    const { root } = get();
    if (!root) return;
    cache = withView(all(), root, { ...view, at: Date.now() });
    writeStored(KEY, JSON.stringify(cache));
  };
  const root = useProject.getState().root;
  return {
    root,
    ...viewOf(root),
    toggle: (facet, value) => {
      const f = get().filter;
      const list = f[facet] as string[];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      apply({ filter: { ...f, [facet]: next } });
    },
    clearFacet: (facet) => apply({ filter: { ...get().filter, [facet]: [] } }),
    setQuery: (query) => apply({ filter: { ...get().filter, query } }),
    clear: () => apply({ filter: emptyFilter }),
    setColourBy: (colourBy) => apply({ colourBy }),
  };
});

// A different book has its own filter: load it when the open book changes.
useProject.subscribe((s) => {
  if (s.root === useSceneFilter.getState().root) return;
  useSceneFilter.setState({ root: s.root, ...viewOf(s.root) });
});

/** For tests: forget everything held in memory and start from `root`. */
export function resetSceneFilter(root: string | null = null): void {
  cache = null;
  useSceneFilter.setState({ root, ...viewOf(root) });
}

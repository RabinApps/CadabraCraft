import { create } from "zustand";
import { createPersistedStore } from "../../lib/persisted";
import { SORTS, type LibrarySort } from "../../app/library/libraryModel";

/** Whether the start screen shows the Library instead of the Home dashboard. Not persisted: the app always starts on Home. */
export const useLibraryOpen = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }),
);

export type LibraryLayout = "grid" | "list";

export interface LibraryPrefs {
  sort: LibrarySort;
  layout: LibraryLayout;
  groupBySeries: boolean;
}

const DEFAULTS: LibraryPrefs = { sort: "edited", layout: "grid", groupBySeries: true };

/** How the Library is arranged. App preference, kept between sessions; corrupt values fall back to the defaults. */
export const useLibraryPrefs = createPersistedStore<LibraryPrefs>({
  key: "cadabracraft.library",
  defaults: DEFAULTS,
  parse: (v) => {
    const o = v as Partial<Record<keyof LibraryPrefs, unknown>> | null;
    if (!o || typeof o !== "object") return null;
    return {
      sort: SORTS.find((s) => s === o.sort) ?? DEFAULTS.sort,
      layout: o.layout === "list" ? "list" : "grid",
      groupBySeries: o.groupBySeries !== false,
    };
  },
});

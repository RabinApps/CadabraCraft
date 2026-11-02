import { createPersistedStore } from "../lib/persisted";

export type TocPane = "edit" | "preview";

/** Which half of the Contents screen shows below the `xl` width (above it both do). App preference only, kept between sessions. */
export const useTocPane = createPersistedStore<{ pane: TocPane }>({
  key: "cadabracraft.tocPane",
  defaults: { pane: "edit" },
  parse: (v) => {
    const pane = (v as { pane?: unknown } | null)?.pane;
    return pane === "edit" || pane === "preview" ? { pane } : null;
  },
});

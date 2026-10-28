import { createPersistedStore } from "../lib/persisted";

interface Prefs {
  focus: boolean;
  details: boolean;
  /** Show the References panel instead of Details (xl screens). */
  references: boolean;
}
const defaults: Prefs = { focus: false, details: true, references: false };

/** Writing-layout preferences (focus mode, details panel). App preference only; never stored in project files. */
export const useLayout = createPersistedStore<Prefs>({
  key: "cadabracraft.layout",
  defaults,
  parse: (v) => {
    const o = v as Partial<Prefs> | null;
    return o && typeof o.focus === "boolean" && typeof o.details === "boolean"
      ? { focus: o.focus, details: o.details, references: o.references === true }
      : null;
  },
});

import { createPersistedStore } from "../../lib/persisted";

/** The chapter list's width on desktop, in CSS pixels. Below `lg` it is a fixed-width sheet instead. */
export const SIDEBAR_DEFAULT_WIDTH = 264;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

interface Prefs {
  focus: boolean;
  details: boolean;
  /** Show the References panel instead of Details (xl screens). */
  references: boolean;
  /** Show the comments rail instead of the other panels (xl screens). */
  comments: boolean;
  /** The chapter list's width on desktop. */
  sidebarWidth: number;
}
const defaults: Prefs = {
  focus: false,
  details: true,
  references: false,
  comments: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
};

/** Writing-layout preferences (focus mode, details panel, sidebar width). App preference only; never stored in project files. */
export const useLayout = createPersistedStore<Prefs>({
  key: "cadabracraft.layout",
  defaults,
  parse: (v) => {
    const o = v as Partial<Prefs> | null;
    return o && typeof o.focus === "boolean" && typeof o.details === "boolean"
      ? {
          focus: o.focus,
          details: o.details,
          references: o.references === true,
          comments: o.comments === true,
          sidebarWidth:
            typeof o.sidebarWidth === "number" && Number.isFinite(o.sidebarWidth)
              ? clampSidebarWidth(o.sidebarWidth)
              : SIDEBAR_DEFAULT_WIDTH,
        }
      : null;
  },
  clean: (next) => ({ ...next, sidebarWidth: clampSidebarWidth(next.sidebarWidth) }),
});

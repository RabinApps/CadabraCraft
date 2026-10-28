import { useCallback, useSyncExternalStore } from "react";
import { type PageZoom, useSettings } from "../../state/editorPrefs";
import { pageViewAvailable, pageViewOn } from "../../state/pageView";
import { useViewMode } from "../../state/viewMode";
import { MD_QUERY } from "../shell/breakpoints";

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(MD_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const snapshot = () => window.matchMedia(MD_QUERY).matches;

/** Whether the window is at least `md` wide (not a phone). */
export const useIsMd = (): boolean => useSyncExternalStore(subscribe, snapshot, () => true);

export interface PageView {
  /** Page view is showing: the preference is on and it is available. */
  on: boolean;
  zoom: PageZoom;
  setZoom: (z: PageZoom) => void;
  /** Flips the stored preference (it also stays stored while Page view is unavailable). */
  toggle: () => void;
  /** Write mode at md+ width; Page view is not offered on phones or in Read mode. */
  available: boolean;
}

/** The single source for Page view: the stored preference combined with where it can be shown. */
export function usePageView(): PageView {
  const pageView = useSettings((s) => s.pageView);
  const zoom = useSettings((s) => s.pageZoom);
  const set = useSettings((s) => s.set);
  const mode = useViewMode((s) => s.mode);
  const wide = useIsMd();
  const available = pageViewAvailable(mode, wide);
  const setZoom = useCallback((pageZoom: PageZoom) => set({ pageZoom }), [set]);
  const toggle = useCallback(() => set({ pageView: !useSettings.getState().pageView }), [set]);
  return { on: pageViewOn(pageView, mode, wide), zoom, setZoom, toggle, available };
}

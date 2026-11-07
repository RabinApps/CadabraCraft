import { useCallback, useSyncExternalStore } from "react";
import { type PageZoom, useSettings } from "../../state/view/editorPrefs";
import { pageViewAvailable } from "../../state/view/pageView";
import { useViewMode } from "../../state/view/viewMode";
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
  /** The page surface is showing (Write mode at md+ width); on a phone the editor reflows instead. */
  on: boolean;
  zoom: PageZoom;
  setZoom: (z: PageZoom) => void;
}

/** The single source for the page surface: whether it shows here, and its zoom. */
export function usePageView(): PageView {
  const zoom = useSettings((s) => s.pageZoom);
  const set = useSettings((s) => s.set);
  const mode = useViewMode((s) => s.mode);
  const wide = useIsMd();
  const setZoom = useCallback((pageZoom: PageZoom) => set({ pageZoom }), [set]);
  return { on: pageViewAvailable(mode, wide), zoom, setZoom };
}

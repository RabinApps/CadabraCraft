import { useSyncExternalStore } from "react";
import { XL_QUERY } from "../shell/breakpoints";

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(XL_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const snapshot = () => window.matchMedia(XL_QUERY).matches;

/** Whether the window is at least `xl` wide (room for the Contents list and its preview side by side). */
export const useIsXl = (): boolean => useSyncExternalStore(subscribe, snapshot, () => true);

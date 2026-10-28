import { create } from "zustand";

/** Page view's measured pages of the open chapter, for the status bar: how many there are (0 when Page view is off) and the 1-based page the cursor is on. */
export const usePageCount = create<{ count: number; current: number }>(() => ({
  count: 0,
  current: 1,
}));

export const setPageCount = (count: number, current?: number): void =>
  usePageCount.setState((s) => {
    const next = Math.min(Math.max(1, current ?? s.current), Math.max(1, count));
    return count === s.count && next === s.current ? s : { count, current: count === 0 ? 1 : next };
  });

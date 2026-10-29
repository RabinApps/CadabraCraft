import { create } from "zustand";

/**
 * Page view's pages of the open chapter, for the status bar: how many there are (0 when Page view is off), the 1-based page the
 * cursor is on, and whether the breaks are Typst's (`exact`) rather than the estimate.
 */
export const usePageCount = create<{ count: number; current: number; exact: boolean }>(() => ({
  count: 0,
  current: 1,
  exact: false,
}));

export const setPageCount = (count: number, current?: number, exact?: boolean): void =>
  usePageCount.setState((s) => {
    const next = Math.min(Math.max(1, current ?? s.current), Math.max(1, count));
    const ex = count === 0 ? false : (exact ?? s.exact);
    return count === s.count && next === s.current && ex === s.exact
      ? s
      : { count, current: count === 0 ? 1 : next, exact: ex };
  });

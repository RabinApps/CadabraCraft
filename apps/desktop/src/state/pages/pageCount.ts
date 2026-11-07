import { create } from "zustand";

/**
 * Page view's pages of the open chapter, for the status bar: how many there are (0 when Page view is off), the 1-based page the
 * cursor is on, and whether the breaks are Typst's (`exact`). `byId` is the pages each entry was last laid out with (a blank page
 * before it not counted), by entry id: the page layout of the book takes them over the word estimate. They are laid out with
 * `key` (template, trim and font): a layout under another key empties the map.
 */
export const usePageCount = create<{
  count: number;
  current: number;
  exact: boolean;
  byId: Readonly<Record<string, number>>;
  key: string;
}>(() => ({
  count: 0,
  current: 1,
  exact: false,
  byId: {},
  key: "",
}));

export const setPageCount = (count: number, current?: number, exact?: boolean): void =>
  usePageCount.setState((s) => {
    const next = Math.min(Math.max(1, current ?? s.current), Math.max(1, count));
    const ex = count === 0 ? false : (exact ?? s.exact);
    return count === s.count && next === s.current && ex === s.exact
      ? s
      : { count, current: count === 0 ? 1 : next, exact: ex };
  });

/** Records that entry `id` laid out to `pages` pages under the layout `key`. */
export const setEntryPages = (id: string, pages: number, key: string): void =>
  usePageCount.setState((s) => {
    const same = s.key === key;
    if (same && s.byId[id] === pages) return s;
    return { key, byId: { ...(same ? s.byId : {}), [id]: pages } };
  });

import { create } from "zustand";

/**
 * The current match of Find in Read mode: its number among all of the book's matches (0-based, -1 for none) and a counter that is
 * bumped each time the reader should scroll to it. The query and its options are the find bar's `useFind` store, shared with Write mode.
 */
export const useReadFind = create<{ index: number; tick: number }>(() => ({ index: -1, tick: 0 }));

/** Makes match `index` the current one and asks the reader to scroll to it. */
export const goToReadMatch = (index: number): void =>
  useReadFind.setState((s) => ({ index, tick: s.tick + 1 }));

/** Moves the current match without scrolling (the matches changed under it). */
export const setReadMatch = (index: number): void => useReadFind.setState({ index });

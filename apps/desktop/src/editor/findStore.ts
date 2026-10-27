import { create } from "zustand";

/**
 * Find bar state. It lives outside the component because the editor is re-keyed per chapter and mode: the bar and its
 * query survive a chapter switch and are applied again to the new editor. Nothing is persisted across sessions.
 */
interface FindData {
  open: boolean;
  /** Replace row shown (default). */
  replace: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** The query is a JavaScript regular expression (see search/match.ts). Off by default, kept for the session only. */
  regex: boolean;
  /** "All chapters": count, step and replace across the whole book (front and back matter too). Off by default, kept for the session only. */
  allChapters: boolean;
  /** Set when stepping opens another page: the new editor selects its first or last match once it mounts. */
  pendingReveal: "first" | "last" | null;
  /** Bumped whenever Find is invoked: the bar focuses and selects its input and applies its settings. */
  focusTick: number;
}

export interface FindState extends FindData {
  set: (patch: Partial<FindData>) => void;
  show: (o: { replace?: boolean; query?: string | null }) => void;
  close: () => void;
  /** Cmd/Ctrl+Alt+F: shows or hides the replace row (opens the bar first when it is closed). */
  toggleReplace: (query?: string | null) => void;
}

export const useFind = create<FindState>((set) => ({
  open: false, replace: true, query: "", replacement: "", matchCase: false, wholeWord: false, regex: false, allChapters: false, pendingReveal: null, focusTick: 0,
  set: (patch) => set(patch),
  show: ({ replace, query }) => set((s) => ({ open: true, replace: replace ?? s.replace, ...(query ? { query } : {}), focusTick: s.focusTick + 1 })),
  close: () => set({ open: false }),
  toggleReplace: (query) => set((s) => ({ open: true, replace: s.open ? !s.replace : true, focusTick: s.focusTick + 1, ...(query ? { query } : {}) })),
}));

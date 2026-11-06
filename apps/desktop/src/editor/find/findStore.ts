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
  /** "All languages" (only with "All chapters", only in a book with translations): counts and Replace all cover every edition. Off by default, kept for the session only. */
  allLanguages: boolean;
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

/** Longest search text and replacement the bar accepts; longer input is cut (a pattern this long is never a real search, and it keeps scans and recounts cheap). */
export const MAX_QUERY_CHARS = 1000;
export const MAX_REPLACEMENT_CHARS = 10000;

const limited = (patch: Partial<FindData>): Partial<FindData> => ({
  ...patch,
  ...(typeof patch.query === "string" ? { query: patch.query.slice(0, MAX_QUERY_CHARS) } : {}),
  ...(typeof patch.replacement === "string"
    ? { replacement: patch.replacement.slice(0, MAX_REPLACEMENT_CHARS) }
    : {}),
});

export const useFind = create<FindState>((set) => ({
  open: false,
  replace: true,
  query: "",
  replacement: "",
  matchCase: false,
  wholeWord: false,
  regex: false,
  allChapters: false,
  allLanguages: false,
  pendingReveal: null,
  focusTick: 0,
  set: (patch) => set(limited(patch)),
  show: ({ replace, query }) =>
    set((s) => ({
      open: true,
      replace: replace ?? s.replace,
      ...(query ? limited({ query }) : {}),
      focusTick: s.focusTick + 1,
    })),
  close: () => set({ open: false }),
  toggleReplace: (query) =>
    set((s) => ({
      open: true,
      replace: s.open ? !s.replace : true,
      focusTick: s.focusTick + 1,
      ...(query ? limited({ query }) : {}),
    })),
}));

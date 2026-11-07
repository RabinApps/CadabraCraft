import { create } from "zustand";

export type ViewMode = "write" | "read";

/** Whether the open book is shown for writing or for reading. Not persisted: a book always opens in Write mode. */
export const useViewMode = create<{ mode: ViewMode; setMode: (m: ViewMode) => void }>((set) => ({
  mode: "write",
  setMode: (mode) => set({ mode }),
}));

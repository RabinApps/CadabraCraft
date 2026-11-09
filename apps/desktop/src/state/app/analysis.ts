import { create } from "zustand";

interface Analysis {
  open: boolean;
  show: () => void;
  close: () => void;
}

/** File > Analysis…: whether the local analysis report is open over the book. */
export const useAnalysis = create<Analysis>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

import { create } from "zustand";

interface WritingDialog {
  open: boolean;
  show: () => void;
  close: () => void;
}

/** File > Writing history…: whether the History screen is open over the book. */
export const useWritingDialog = create<WritingDialog>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

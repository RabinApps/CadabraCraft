import { create } from "zustand";

/** Which quick-navigation dialog is open: the command palette (Cmd/Ctrl+K), the outline navigator (Cmd/Ctrl+Shift+O), or none. */
export type QuickNavPanel = "palette" | "outline";

interface QuickNavState {
  panel: QuickNavPanel | null;
  show: (panel: QuickNavPanel) => void;
  close: () => void;
}

export const useQuickNav = create<QuickNavState>((set) => ({
  panel: null,
  show: (panel) => set({ panel }),
  close: () => set({ panel: null }),
}));

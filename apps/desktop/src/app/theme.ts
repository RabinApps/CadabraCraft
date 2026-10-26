import { create } from "zustand";

export type Theme = "system" | "light" | "dark";
const KEY = "cadabracraft.theme";

const isTheme = (v: unknown): v is Theme => v === "system" || v === "light" || v === "dark";

/** App preference only; never stored in project files. */
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
}

export const useTheme = create<{ theme: Theme; setTheme: (t: Theme) => void }>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable: keep in memory */ }
    applyTheme(theme);
    set({ theme });
  },
}));

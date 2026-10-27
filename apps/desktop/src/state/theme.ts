import { create } from "zustand";
import { readStored, writeStored } from "../lib/persisted";

export type Theme = "system" | "light" | "dark";
const KEY = "cadabracraft.theme";

const isTheme = (v: unknown): v is Theme => v === "system" || v === "light" || v === "dark";

/** App preference only; never stored in project files. */
export function readTheme(): Theme {
  const v = readStored(KEY);
  return isTheme(v) ? v : "system";
}

const dark = () => window.matchMedia("(prefers-color-scheme: dark)");

/** CSS only knows light and dark, so "system" is resolved here (and re-resolved when the OS setting changes). */
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t === "system" ? (dark().matches ? "dark" : "light") : t;
}

dark().addEventListener("change", () => { if (useTheme.getState().theme === "system") applyTheme("system"); });

export const useTheme = create<{ theme: Theme; setTheme: (t: Theme) => void }>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    writeStored(KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
}));

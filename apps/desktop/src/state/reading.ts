import { create } from "zustand";

const KEY = "cadabracraft.reading";
/** Text sizes in rem, smallest to largest. */
export const sizes = [1.0625, 1.1875, 1.3125, 1.4375, 1.5625];
export type Width = "narrow" | "wide";
export const widths: Record<Width, number> = { narrow: 560, wide: 740 };

interface Prefs { size: number; width: Width }
const defaults: Prefs = { size: 2, width: "narrow" };

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && Number.isInteger(v.size) && v.size >= 0 && v.size < sizes.length && (v.width === "narrow" || v.width === "wide")) return v;
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return defaults;
}

/** Reading-mode preferences. App preference only; never stored in project files. */
export const useReading = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set, get) => ({
  ...read(),
  set: (p) => {
    const next = { size: get().size, width: get().width, ...p };
    next.size = Math.min(sizes.length - 1, Math.max(0, next.size));
    try { localStorage.setItem(KEY, JSON.stringify({ size: next.size, width: next.width })); } catch { /* keep in memory */ }
    set(next);
  },
}));

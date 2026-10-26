import { create } from "zustand";

const KEY = "cadabracraft.layout";

interface Prefs { focus: boolean; details: boolean }
const defaults: Prefs = { focus: false, details: true };

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.focus === "boolean" && typeof v.details === "boolean") return { focus: v.focus, details: v.details };
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return defaults;
}

/** Writing-layout preferences (focus mode, details panel). App preference only; never stored in project files. */
export const useLayout = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set, get) => ({
  ...read(),
  set: (p) => {
    const next = { focus: get().focus, details: get().details, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* keep in memory */ }
    set(next);
  },
}));

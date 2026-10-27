import { create } from "zustand";

const KEY = "cadabracraft.settings";

export type ManuscriptFont = "newsreader" | "inter";
export type WritingWidth = "narrow" | "medium" | "wide";

/** Writing column widths in px for the editor page card. */
export const writingWidths: Record<WritingWidth, number> = { narrow: 620, medium: 780, wide: 960 };
/** CSS font stacks for the manuscript, keyed by the stored choice. */
export const manuscriptFonts: Record<ManuscriptFont, string> = { newsreader: "var(--font-book)", inter: "var(--font-ui)" };

/** Largest session goal the Settings field accepts. */
export const MAX_SESSION_GOAL = 100000;

interface Prefs { manuscriptFont: ManuscriptFont; writingWidth: WritingWidth; typewriterScroll: boolean; /** Words to write per session; 0 turns the goal off. */ sessionGoal: number }
const defaults: Prefs = { manuscriptFont: "newsreader", writingWidth: "medium", typewriterScroll: false, sessionGoal: 0 };

/** A whole number in 0..MAX_SESSION_GOAL; anything else becomes 0 (off). */
export const cleanGoal = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_SESSION_GOAL) : 0);

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && v.manuscriptFont in manuscriptFonts && v.writingWidth in writingWidths && typeof v.typewriterScroll === "boolean") {
      return { manuscriptFont: v.manuscriptFont, writingWidth: v.writingWidth, typewriterScroll: v.typewriterScroll, sessionGoal: cleanGoal(v.sessionGoal) };
    }
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return defaults;
}

/** Editor and manuscript preferences shown on the Settings page. App preference only; never stored in project files. */
export const useSettings = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set, get) => ({
  ...read(),
  set: (p) => {
    const { manuscriptFont, writingWidth, typewriterScroll, sessionGoal } = { ...get(), ...p };
    const next = { manuscriptFont, writingWidth, typewriterScroll, sessionGoal: cleanGoal(sessionGoal) };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* keep in memory */ }
    set(next);
  },
}));

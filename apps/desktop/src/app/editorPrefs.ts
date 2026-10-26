import { create } from "zustand";

const KEY = "cadabracraft.settings";

export type ManuscriptFont = "newsreader" | "inter";
export type WritingWidth = "narrow" | "medium" | "wide";

/** Writing column widths in px for the editor page card. */
export const writingWidths: Record<WritingWidth, number> = { narrow: 620, medium: 780, wide: 960 };
/** CSS font stacks for the manuscript, keyed by the stored choice. */
export const manuscriptFonts: Record<ManuscriptFont, string> = { newsreader: "var(--font-book)", inter: "var(--font-ui)" };

interface Prefs { manuscriptFont: ManuscriptFont; writingWidth: WritingWidth; typewriterScroll: boolean }
const defaults: Prefs = { manuscriptFont: "newsreader", writingWidth: "medium", typewriterScroll: false };

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && v.manuscriptFont in manuscriptFonts && v.writingWidth in writingWidths && typeof v.typewriterScroll === "boolean") {
      return { manuscriptFont: v.manuscriptFont, writingWidth: v.writingWidth, typewriterScroll: v.typewriterScroll };
    }
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return defaults;
}

/** Editor and manuscript preferences shown on the Settings page. App preference only; never stored in project files. */
export const useSettings = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set, get) => ({
  ...read(),
  set: (p) => {
    const { manuscriptFont, writingWidth, typewriterScroll } = { ...get(), ...p };
    const next = { manuscriptFont, writingWidth, typewriterScroll };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* keep in memory */ }
    set(next);
  },
}));

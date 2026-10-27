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

/** How many snapshots of each page are kept (older ones are removed, but never those younger than 30 days). */
export const SNAPSHOT_KEEP_MIN = 5;
export const SNAPSHOT_KEEP_MAX = 500;
export const SNAPSHOT_KEEP_DEFAULT = 50;
/** A whole number in the allowed range; anything else becomes the default. */
export const cleanSnapshotKeep = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) ? Math.min(SNAPSHOT_KEEP_MAX, Math.max(SNAPSHOT_KEEP_MIN, v)) : SNAPSHOT_KEEP_DEFAULT;

export type RawHtmlPaste = "ask" | "convert" | "text";
const rawHtmlPastes: readonly RawHtmlPaste[] = ["ask", "convert", "text"];
/** A stored choice for pasted HTML text, or "ask" when it is missing or unknown. */
export const cleanRawHtmlPaste = (v: unknown): RawHtmlPaste => (rawHtmlPastes.includes(v as RawHtmlPaste) ? (v as RawHtmlPaste) : "ask");

export type AudioFormatPref = "opus" | "flac" | "wav";
const AUDIO_FORMATS: readonly AudioFormatPref[] = ["opus", "flac", "wav"];
/** Stored default audio formats in display order; at least one, Opus when missing or unknown. */
export const cleanAudioFormats = (v: unknown): AudioFormatPref[] => {
  const list = Array.isArray(v) ? AUDIO_FORMATS.filter((f) => v.includes(f)) : [];
  return list.length > 0 ? list : ["opus"];
};
/** A stored default voice id, or "" (the first installed voice) when missing. */
export const cleanAudioVoice = (v: unknown): string => (typeof v === "string" && v.length <= 64 ? v : "");

interface Prefs { /** Voice id preselected in the audiobook export; "" picks the first installed. */ audioVoice: string; /** Formats preselected in the audiobook export. */ audioFormats: AudioFormatPref[]; manuscriptFont: ManuscriptFont; writingWidth: WritingWidth; typewriterScroll: boolean; /** Words to write per session; 0 turns the goal off. */ sessionGoal: number; /** What pasting text that contains HTML tags does. */ rawHtmlPaste: RawHtmlPaste; /** Snapshots kept per page. */ snapshotKeep: number }
const defaults: Prefs = { manuscriptFont: "newsreader", writingWidth: "medium", typewriterScroll: false, sessionGoal: 0, rawHtmlPaste: "ask", snapshotKeep: SNAPSHOT_KEEP_DEFAULT, audioVoice: "", audioFormats: ["opus"] };

/** A whole number in 0..MAX_SESSION_GOAL; anything else becomes 0 (off). */
export const cleanGoal = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_SESSION_GOAL) : 0);

function read(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.manuscriptFont === "string" && Object.hasOwn(manuscriptFonts, v.manuscriptFont) && typeof v.writingWidth === "string" && Object.hasOwn(writingWidths, v.writingWidth) && typeof v.typewriterScroll === "boolean") {
      return { manuscriptFont: v.manuscriptFont, writingWidth: v.writingWidth, typewriterScroll: v.typewriterScroll, sessionGoal: cleanGoal(v.sessionGoal), rawHtmlPaste: cleanRawHtmlPaste(v.rawHtmlPaste), snapshotKeep: cleanSnapshotKeep(v.snapshotKeep), audioVoice: cleanAudioVoice(v.audioVoice), audioFormats: cleanAudioFormats(v.audioFormats) };
    }
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return defaults;
}

/** Editor and manuscript preferences shown on the Settings page. App preference only; never stored in project files. */
export const useSettings = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set, get) => ({
  ...read(),
  set: (p) => {
    const { manuscriptFont, writingWidth, typewriterScroll, sessionGoal, rawHtmlPaste, snapshotKeep, audioVoice, audioFormats } = { ...get(), ...p };
    const next = { manuscriptFont, writingWidth, typewriterScroll, sessionGoal: cleanGoal(sessionGoal), rawHtmlPaste: cleanRawHtmlPaste(rawHtmlPaste), snapshotKeep: cleanSnapshotKeep(snapshotKeep), audioVoice: cleanAudioVoice(audioVoice), audioFormats: cleanAudioFormats(audioFormats) };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* keep in memory */ }
    set(next);
  },
}));

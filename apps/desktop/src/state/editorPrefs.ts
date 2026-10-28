import type { AudioFormat } from "@cadabracraft/export-audio";
import { AUDIO_FORMATS } from "../lib/audioFormats";
import { createPersistedStore } from "../lib/persisted";

/** The font of the manuscript in the editor (not the Word export font, which is `ManuscriptFont` in export-docx). */
export type EditorFont = "newsreader" | "inter";
export type WritingWidth = "narrow" | "medium" | "wide";

/** Writing column widths in px for the editor page card. */
export const writingWidths: Record<WritingWidth, number> = { narrow: 620, medium: 780, wide: 960 };
/** CSS font stacks for the manuscript, keyed by the stored choice. */
export const editorFonts: Record<EditorFont, string> = {
  newsreader: "var(--font-book)",
  inter: "var(--font-ui)",
};

/** Largest session goal the Settings field accepts. */
export const MAX_SESSION_GOAL = 100000;

/** How many snapshots of each page are kept (older ones are removed, but never those younger than 30 days). */
export const SNAPSHOT_KEEP_MIN = 5;
export const SNAPSHOT_KEEP_MAX = 500;
export const SNAPSHOT_KEEP_DEFAULT = 50;
/** A whole number in the allowed range; anything else becomes the default. */
export const cleanSnapshotKeep = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v)
    ? Math.min(SNAPSHOT_KEEP_MAX, Math.max(SNAPSHOT_KEEP_MIN, v))
    : SNAPSHOT_KEEP_DEFAULT;

export type RawHtmlPaste = "ask" | "convert" | "text";
const rawHtmlPastes: readonly RawHtmlPaste[] = ["ask", "convert", "text"];
/** A stored choice for pasted HTML text, or "ask" when it is missing or unknown. */
export const cleanRawHtmlPaste = (v: unknown): RawHtmlPaste =>
  rawHtmlPastes.includes(v as RawHtmlPaste) ? (v as RawHtmlPaste) : "ask";

/** Stored default audio formats in display order; at least one, Opus when missing or unknown. */
export const cleanAudioFormats = (v: unknown): AudioFormat[] => {
  const list = Array.isArray(v) ? AUDIO_FORMATS.filter((f) => v.includes(f)) : [];
  return list.length > 0 ? list : ["opus"];
};
/** A stored default voice id, or "" (the first installed voice) when missing. */
export const cleanAudioVoice = (v: unknown): string =>
  typeof v === "string" && v.length <= 64 ? v : "";

interface Prefs {
  /** Voice id preselected in the audiobook export; "" picks the first installed. */ audioVoice: string;
  /** Formats preselected in the audiobook export. */ audioFormats: AudioFormat[];
  manuscriptFont: EditorFont;
  writingWidth: WritingWidth;
  typewriterScroll: boolean;
  /** Words to write per session; 0 turns the goal off. */ sessionGoal: number;
  /** What pasting text that contains HTML tags does. */ rawHtmlPaste: RawHtmlPaste;
  /** Snapshots kept per page. */ snapshotKeep: number;
}
const defaults: Prefs = {
  manuscriptFont: "newsreader",
  writingWidth: "medium",
  typewriterScroll: false,
  sessionGoal: 0,
  rawHtmlPaste: "ask",
  snapshotKeep: SNAPSHOT_KEEP_DEFAULT,
  audioVoice: "",
  audioFormats: ["opus"],
};

/** A whole number in 0..MAX_SESSION_GOAL; anything else becomes 0 (off). */
export const cleanGoal = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_SESSION_GOAL) : 0;

/** The stored preferences, or null when they are missing or not in the expected shape. */
function parsePrefs(v: unknown): Prefs | null {
  const o = v as Partial<Record<keyof Prefs, unknown>> | null;
  if (
    o &&
    typeof o.manuscriptFont === "string" &&
    Object.hasOwn(editorFonts, o.manuscriptFont) &&
    typeof o.writingWidth === "string" &&
    Object.hasOwn(writingWidths, o.writingWidth) &&
    typeof o.typewriterScroll === "boolean"
  ) {
    return {
      manuscriptFont: o.manuscriptFont as EditorFont,
      writingWidth: o.writingWidth as WritingWidth,
      typewriterScroll: o.typewriterScroll,
      sessionGoal: cleanGoal(o.sessionGoal),
      rawHtmlPaste: cleanRawHtmlPaste(o.rawHtmlPaste),
      snapshotKeep: cleanSnapshotKeep(o.snapshotKeep),
      audioVoice: cleanAudioVoice(o.audioVoice),
      audioFormats: cleanAudioFormats(o.audioFormats),
    };
  }
  return null;
}

/** Editor and manuscript preferences shown on the Settings page. App preference only; never stored in project files. */
export const useSettings = createPersistedStore<Prefs>({
  key: "cadabracraft.settings",
  defaults,
  parse: parsePrefs,
  clean: (p) => ({
    manuscriptFont: p.manuscriptFont,
    writingWidth: p.writingWidth,
    typewriterScroll: p.typewriterScroll,
    sessionGoal: cleanGoal(p.sessionGoal),
    rawHtmlPaste: cleanRawHtmlPaste(p.rawHtmlPaste),
    snapshotKeep: cleanSnapshotKeep(p.snapshotKeep),
    audioVoice: cleanAudioVoice(p.audioVoice),
    audioFormats: cleanAudioFormats(p.audioFormats),
  }),
});

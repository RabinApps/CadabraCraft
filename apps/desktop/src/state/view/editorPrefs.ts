import type { AudioFormat } from "@cadabracraft/export-audio";
import { AUDIO_FORMATS } from "../../lib/audio/audioFormats";
import { createPersistedStore } from "../../lib/persisted";
import { cleanOverrides, type Overrides } from "../../lib/shortcutCombo";
import type { Sprint } from "@cadabracraft/shared";
import { DEFAULT_SPRINT_MINUTES, cleanSprint, newSprint, parseSprint } from "./sprintPrefs";

/** A font the pages can be drawn in (not the Word export font, which is `ManuscriptFont` in export-docx): "newsreader", "inter" or a family name. */
export type EditorFont = "newsreader" | "inter" | (string & {});
/** The two fonts that come with the app; any other value is a family name (installed, downloaded or imported). */
export const BUNDLED_EDITOR_FONTS = ["newsreader", "inter"] as const;
/** CSS font stacks for the bundled fonts. */
export const editorFonts: Record<(typeof BUNDLED_EDITOR_FONTS)[number], string> = {
  newsreader: "var(--font-book)",
  inter: "var(--font-ui)",
};

/** The CSS `font-family` for a stored choice: a bundled stack, or the family name with the default serif behind it. */
export const editorFontStack = (font: EditorFont): string =>
  Object.hasOwn(editorFonts, font)
    ? editorFonts[font as keyof typeof editorFonts]
    : `"${font.replace(/["\\]/g, "\\$&")}", ${editorFonts.newsreader}`;

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

/** How many whole-book snapshots are kept (older ones move to the project trash; pinned ones are not counted out). */
export const BOOK_SNAPSHOT_KEEP_MIN = 5;
export const BOOK_SNAPSHOT_KEEP_MAX = 200;
export const BOOK_SNAPSHOT_KEEP_DEFAULT = 50;
/** A whole number in the allowed range; anything else becomes the default. */
export const cleanBookSnapshotKeep = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v)
    ? Math.min(BOOK_SNAPSHOT_KEEP_MAX, Math.max(BOOK_SNAPSHOT_KEEP_MIN, v))
    : BOOK_SNAPSHOT_KEEP_DEFAULT;

/** The most megabytes all whole-book snapshots of a book may take together. */
export const BOOK_SNAPSHOT_MAX_MB_MIN = 100;
export const BOOK_SNAPSHOT_MAX_MB_MAX = 4096;
export const BOOK_SNAPSHOT_MAX_MB_DEFAULT = 1024;
/** A whole number in the allowed range; anything else becomes the default. */
export const cleanBookSnapshotMaxMb = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v)
    ? Math.min(BOOK_SNAPSHOT_MAX_MB_MAX, Math.max(BOOK_SNAPSHOT_MAX_MB_MIN, v))
    : BOOK_SNAPSHOT_MAX_MB_DEFAULT;

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

/** Page zoom: "fit" fills the pane width; the numbers are fixed scales. */
export type PageZoom = "fit" | 0.75 | 1 | 1.25;
export const PAGE_ZOOM_CHOICES: readonly PageZoom[] = ["fit", 0.75, 1, 1.25];
/** A stored page zoom, or "fit" when it is missing or not one of the offered values. */
export const cleanPageZoom = (v: unknown): PageZoom =>
  PAGE_ZOOM_CHOICES.includes(v as PageZoom) ? (v as PageZoom) : "fit";

/** A stored smart typography switch; off unless it is exactly true. */
export const cleanSmartTypography = (v: unknown): boolean => v === true;

interface Prefs {
  /** Voice id preselected in the audiobook export; "" picks the first installed. */ audioVoice: string;
  /** Formats preselected in the audiobook export. */ audioFormats: AudioFormat[];
  typewriterScroll: boolean;
  /** Quotes, dashes and the ellipsis become their typographic glyphs as the author types (app-wide, off by default). */ smartTypography: boolean;
  /** Words to write per session; 0 turns the goal off. */ sessionGoal: number;
  /** What pasting text that contains HTML tags does. */ rawHtmlPaste: RawHtmlPaste;
  /** Snapshots kept per page. */ snapshotKeep: number;
  /** Whole-book snapshots kept per book. */ bookSnapshotKeep: number;
  /** Megabytes all whole-book snapshots of a book may take together. */ bookSnapshotMaxMb: number;
  /** Zoom of the pages in the editor. */ pageZoom: PageZoom;
  /** Keys the author changed in Settings > Shortcuts, by command id; everything else keeps its default. */ shortcutOverrides: Overrides;
  /** The sprint timer in the status bar (a sprint that was running is read back paused). */ sprint: Sprint;
}
const defaults: Prefs = {
  typewriterScroll: false,
  smartTypography: false,
  sessionGoal: 0,
  rawHtmlPaste: "ask",
  snapshotKeep: SNAPSHOT_KEEP_DEFAULT,
  bookSnapshotKeep: BOOK_SNAPSHOT_KEEP_DEFAULT,
  bookSnapshotMaxMb: BOOK_SNAPSHOT_MAX_MB_DEFAULT,
  audioVoice: "",
  audioFormats: ["opus"],
  pageZoom: "fit",
  shortcutOverrides: {},
  sprint: newSprint(DEFAULT_SPRINT_MINUTES),
};

/** A whole number in 0..MAX_SESSION_GOAL; anything else becomes 0 (off). */
export const cleanGoal = (v: unknown): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_SESSION_GOAL) : 0;

/** The stored preferences, or null when they are missing or not in the expected shape. */
function parsePrefs(v: unknown): Prefs | null {
  const o = v as Partial<Record<keyof Prefs, unknown>> | null;
  if (o && typeof o.typewriterScroll === "boolean") {
    return {
      typewriterScroll: o.typewriterScroll,
      smartTypography: cleanSmartTypography(o.smartTypography),
      sessionGoal: cleanGoal(o.sessionGoal),
      rawHtmlPaste: cleanRawHtmlPaste(o.rawHtmlPaste),
      snapshotKeep: cleanSnapshotKeep(o.snapshotKeep),
      bookSnapshotKeep: cleanBookSnapshotKeep(o.bookSnapshotKeep),
      bookSnapshotMaxMb: cleanBookSnapshotMaxMb(o.bookSnapshotMaxMb),
      audioVoice: cleanAudioVoice(o.audioVoice),
      audioFormats: cleanAudioFormats(o.audioFormats),
      pageZoom: cleanPageZoom(o.pageZoom),
      shortcutOverrides: cleanOverrides(o.shortcutOverrides),
      sprint: parseSprint(o.sprint),
    };
  }
  return null;
}

/** Editor preferences shown on the Settings page. App preference only; never stored in project files. */
export const useSettings = createPersistedStore<Prefs>({
  key: "cadabracraft.settings",
  defaults,
  parse: parsePrefs,
  clean: (p) => ({
    typewriterScroll: p.typewriterScroll,
    smartTypography: cleanSmartTypography(p.smartTypography),
    sessionGoal: cleanGoal(p.sessionGoal),
    rawHtmlPaste: cleanRawHtmlPaste(p.rawHtmlPaste),
    snapshotKeep: cleanSnapshotKeep(p.snapshotKeep),
    bookSnapshotKeep: cleanBookSnapshotKeep(p.bookSnapshotKeep),
    bookSnapshotMaxMb: cleanBookSnapshotMaxMb(p.bookSnapshotMaxMb),
    audioVoice: cleanAudioVoice(p.audioVoice),
    audioFormats: cleanAudioFormats(p.audioFormats),
    pageZoom: cleanPageZoom(p.pageZoom),
    shortcutOverrides: cleanOverrides(p.shortcutOverrides),
    sprint: cleanSprint(p.sprint),
  }),
});

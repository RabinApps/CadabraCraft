import { PAUSE_MS, type Chunk } from "./chunk";

/** What a transcript is made from: the chunks exactly as they were handed to the voice, and how long the audio came out. */
export interface TranscriptChapter {
  title: string;
  chunks: Chunk[];
  durationSec: number;
}

/**
 * About how many characters a voice reads per second at normal speed. Only used to place the cues of a
 * chapter relative to each other; the chapter's real duration scales them, so the last cue always ends with the audio.
 */
const CHARS_PER_SECOND = 15;

/** Paragraphs of one chapter: chunks join until a pause that ends a paragraph, heading or scene. */
function paragraphs(chunks: Chunk[]): { text: string; scene: boolean }[] {
  const out: { text: string; scene: boolean }[] = [];
  let current = "";
  for (const c of chunks) {
    current = current ? `${current} ${c.text}` : c.text;
    if (c.pauseAfterMs >= PAUSE_MS.paragraph) {
      out.push({ text: current, scene: c.pauseAfterMs >= PAUSE_MS.scene });
      current = "";
    }
  }
  if (current) out.push({ text: current, scene: false });
  return out;
}

/**
 * The plain-text transcript of a book: its title, then each chapter's title and paragraphs, exactly as the voice was given
 * them (so it matches the audio, including what narration left out). Scene breaks are written as `* * *`.
 */
export function plainTranscript(bookTitle: string, chapters: TranscriptChapter[]): string {
  const parts = [bookTitle.trim()].filter(Boolean);
  for (const chapter of chapters) {
    const lines: string[] = [];
    for (const p of paragraphs(chapter.chunks)) {
      lines.push(p.text);
      if (p.scene) lines.push("* * *");
    }
    if (lines.length > 0) parts.push(lines.join("\n\n"));
  }
  return `${parts.join("\n\n\n")}\n`;
}

/** `00:01:02.345`: WebVTT timestamps always carry hours and milliseconds here. */
export function vttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000), 2)}:${p(Math.floor(ms / 60_000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)}.${p(ms % 1000, 3)}`;
}

/** Cue text may not hold `&`, `<` or `>` (a `-->` would end the cue) and may not have blank lines. */
const vttText = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\s*\n\s*/g, " ");

/** Start and end of each chunk, in seconds from the start of the chapter's audio. */
export function cueTimes(chapter: TranscriptChapter): { start: number; end: number }[] {
  const spoken = chapter.chunks.map((c) => c.text.length / CHARS_PER_SECOND);
  const total = chapter.chunks.reduce((n, c, i) => n + spoken[i]! + c.pauseAfterMs / 1000, 0);
  if (total <= 0 || chapter.durationSec <= 0)
    return chapter.chunks.map(() => ({ start: 0, end: 0 }));
  const scale = chapter.durationSec / total;
  let at = 0;
  return chapter.chunks.map((c, i) => {
    const start = at;
    const end = start + spoken[i]! * scale;
    at = end + (c.pauseAfterMs / 1000) * scale;
    return { start, end };
  });
}

/**
 * The WebVTT captions of one chapter, one cue per chunk, timed from the start of the chapter's own audio file. The chunk
 * boundaries are the ones the voice was given; the times are placed in proportion to text length and pauses and scaled to
 * the real duration, so they follow the audio closely but are not word-accurate. `language` (a BCP 47 tag) is written in
 * the header.
 */
export function chapterVtt(chapter: TranscriptChapter, language?: string): string {
  const times = cueTimes(chapter);
  const lang = language && /^[A-Za-z0-9-]{1,35}$/.test(language) ? `\nLanguage: ${language}` : "";
  const cues = chapter.chunks.map(
    (c, i) =>
      `${i + 1}\n${vttTime(times[i]!.start)} --> ${vttTime(times[i]!.end)}\n${vttText(c.text)}`,
  );
  return `WEBVTT${lang}\n\nNOTE Cue times are estimated from the text and the length of the audio.\n\n${cues.join("\n\n")}\n`;
}

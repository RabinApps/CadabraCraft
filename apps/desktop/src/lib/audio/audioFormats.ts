import type { AudioFormat, VoiceInfo } from "@cadabracraft/export-audio";

/** Display order of the audio formats; the order the files are written in too. The one list the app uses. */
export const AUDIO_FORMATS: readonly AudioFormat[] = ["opus", "flac", "wav", "m4b"];

export const AUDIO_SPEEDS = [0.9, 1, 1.1, 1.25] as const;

/** The primary language subtag of a BCP 47 tag (`pt-BR` is `pt`), which is what voices are listed by. */
export const primaryLanguage = (tag: string): string => tag.split("-")[0]!.toLowerCase();

/** Installed voices that read `language` (a book edition's tag), best quality first. */
export const voicesFor = (voices: VoiceInfo[], language: string): VoiceInfo[] =>
  voices.filter((v) => v.installed && v.languages.includes(primaryLanguage(language)));

/** The first installed voice that reads `language`, or "" when there is none: the catalog lists the best quality one first. */
export const defaultVoice = (voices: VoiceInfo[], language: string): string =>
  voicesFor(voices, language)[0]?.id ?? "";

/** Download sizes are shown in decimal megabytes, like the operating system does. */
export const mb = (bytes: number): number => Math.max(1, Math.round(bytes / 1e6));

/** The formats after ticking or unticking `format`, in display order; null when that would leave none (at least one stays chosen). */
export function toggleAudioFormat(
  current: readonly AudioFormat[],
  format: AudioFormat,
  on: boolean,
): AudioFormat[] | null {
  const next = AUDIO_FORMATS.filter((x) => (x === format ? on : current.includes(x)));
  return next.length > 0 ? next : null;
}

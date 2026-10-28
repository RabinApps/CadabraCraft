import type { AudioFormat, VoiceInfo } from "@cadabracraft/export-audio";

/** Display order of the audio formats; the order the files are written in too. The one list the app uses. */
export const AUDIO_FORMATS: readonly AudioFormat[] = ["opus", "flac", "wav"];

export const AUDIO_SPEEDS = [0.9, 1, 1.1, 1.25] as const;

/** The first installed voice: the catalog lists the best quality one first. */
export const defaultVoice = (voices: VoiceInfo[]): string =>
  voices.find((v) => v.installed)?.id ?? "";

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

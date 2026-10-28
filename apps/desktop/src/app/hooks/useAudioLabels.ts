import { useLingui } from "@lingui/react/macro";
import type { AudioFormat } from "@cadabracraft/export-audio";

/** Translated names for the audio voices and formats, shared by the export dialog and Settings. */
export function useAudioLabels() {
  const { t } = useLingui();
  const voice = (id: string): string =>
    id === "kokoro-heart"
      ? t`Kokoro · Heart (best quality)`
      : id === "piper-amy"
        ? t`Piper · Amy (fast)`
        : id === "piper-libritts-0"
          ? t`Piper · LibriTTS (fast)`
          : id;
  const format = (f: AudioFormat) =>
    f === "opus"
      ? {
          label: t`Opus`,
          hint: t`Small files, about 14 MB per hour. Plays on phones and modern players.`,
        }
      : f === "flac"
        ? { label: t`FLAC`, hint: t`Lossless, about 60% of the size of WAV.` }
        : { label: t`WAV`, hint: t`Lossless and large: about 1.7 GB per 10 hours.` };
  return { voice, format };
}

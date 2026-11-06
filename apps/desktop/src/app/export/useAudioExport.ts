import { useEffect, useState } from "react";
import type { AudioFormat, VoiceInfo } from "@cadabracraft/export-audio";
import { sourceEdition } from "@cadabracraft/format";
import { AUDIO_SPEEDS, voicesFor } from "../../lib/audio/audioFormats";
import { PdfUiError } from "../../lib/export/pdfErrors";
import { errText } from "../../lib/projectError";
import { useProject } from "../../state/project";
import { useSettings } from "../../state/view/editorPrefs";
import { useAudioSample } from "./parts/useAudioSample";
import { translationState } from "./parts/audioTranslation";
import { useVoiceCatalog } from "./parts/useVoiceCatalog";
import { useVoicePackChoice } from "./parts/useVoicePackChoice";

/** The voice of an edition: the author's pick if it still reads that language, else the Settings default, else the best one. */
const chooseVoice = (readers: VoiceInfo[], picked: string | undefined): string =>
  (
    readers.find((v) => v.id === picked) ??
    readers.find((v) => v.id === useSettings.getState().audioVoice) ??
    readers[0]
  )?.id ?? "";

/**
 * Everything the Audiobook format of the Export dialog needs: the installed voices and downloadable packs, the choices
 * (voice, speed, formats, chapters), the sample player, and the start/download handlers. `active` is true while the dialog
 * is open on Audiobook; failures go to `setError`. The job and the download themselves live in the project store.
 */
export function useAudioExport({
  active,
  setError,
}: {
  active: boolean;
  setError: (e: PdfUiError | null) => void;
}) {
  const exportAudio = useProject((s) => s.actions.exportAudio);
  const cancelAudio = useProject((s) => s.actions.cancelAudio);
  const dismissAudio = useProject((s) => s.actions.dismissAudio);
  const cancelVoiceDownload = useProject((s) => s.actions.cancelVoiceDownload);
  const dismissVoiceDownload = useProject((s) => s.actions.dismissVoiceDownload);
  const manifest = useProject((s) => s.manifest);
  const activeLanguage = useProject((s) => s.activeLanguage);
  const { voices, packs, refreshVoices } = useVoiceCatalog(setError);
  // The edition to read (the open one until the author picks another), its voice, and whether its untranslated chapters are left out.
  const current = activeLanguage ?? (manifest ? sourceEdition(manifest.editions).language : "");
  const [edition, setEdition] = useState<string | null>(null);
  const language =
    edition && manifest?.editions.some((e) => e.language === edition) ? edition : current;
  const [skipUntranslated, setSkipUntranslated] = useState(false);
  const [voiceFor, setVoiceFor] = useState<Record<string, string>>({});
  const [speed, setSpeed] = useState<number>(AUDIO_SPEEDS[1]);
  const [audioFormats, setAudioFormats] = useState<AudioFormat[]>(
    () => useSettings.getState().audioFormats,
  );
  const [transcript, setTranscript] = useState(false);
  const { sample, stopSample, hear: hearSample, cancelAudioSample } = useAudioSample(setError);
  const [audioChapters, setAudioChapters] = useState<string[] | null>(null);

  useEffect(() => {
    if (!active) return;
    setEdition(null);
    setSkipUntranslated(false);
    let live = true;
    void refreshVoices(() => live);
    return () => {
      live = false;
    };
  }, [active, refreshVoices]);

  // The voice of each edition: the author's pick if it still reads that language, else the Settings default, else the best one.
  const readers = voicesFor(voices ?? [], language);
  const voice = chooseVoice(readers, voiceFor[language]);
  const setVoice = (id: string) => setVoiceFor((m) => ({ ...m, [language]: id }));
  const pickEdition = (l: string) => {
    setEdition(l);
    setSkipUntranslated(false);
    setAudioChapters(null);
  };
  const { untranslated, blocked, rows } = translationState(manifest, language, skipUntranslated);
  const pack = useVoicePackChoice({ voices, packs, setError, refreshVoices });

  const hear = () =>
    hearSample({
      voice,
      speed,
      language,
      skipUntranslated,
      ...(audioChapters ? { chapterIds: audioChapters } : {}),
    });
  const startAudio = () => {
    stopSample();
    setError(null);
    exportAudio({
      voice,
      speed,
      formats: audioFormats,
      language,
      skipUntranslated,
      transcript,
      ...(audioChapters ? { chapterIds: audioChapters } : {}),
    }).catch((e) => setError(new PdfUiError("other", errText(e))));
  };
  /** The dialog is closing: stop any sample, and (on Audiobook) clear a finished job or failed download. */
  const reset = (onAudiobook: boolean) => {
    cancelAudioSample();
    stopSample();
    pack.setGetMore(false);
    if (onAudiobook) {
      dismissAudio();
      dismissVoiceDownload();
    }
  };
  /** The primary action of the form: start the download when voices are being offered, else the export. */
  const submit = () =>
    pack.showDownload
      ? pack.download?.status === "running" || pack.chosenPacks.length === 0
        ? undefined
        : pack.startDownload()
      : startAudio();

  return {
    ...pack,
    voices,
    language,
    pickEdition,
    skipUntranslated,
    setSkipUntranslated,
    untranslated,
    blocked,
    rows,
    voice,
    readers,
    setVoice,
    speed,
    setSpeed,
    audioFormats,
    setAudioFormats,
    transcript,
    setTranscript,
    audioChapters,
    setAudioChapters,
    sample,
    hear,
    reset,
    submit,
    cancelAudio,
    dismissAudio,
    cancelVoiceDownload,
    dismissVoiceDownload,
  };
}
export type AudioExport = ReturnType<typeof useAudioExport>;

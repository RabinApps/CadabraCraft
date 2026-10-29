import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioFormat, VoiceInfo } from "@cadabracraft/export-audio";
import { entryRowsIn, isTranslated, sourceEdition } from "@cadabracraft/format";
import { bridge, type VoicePack } from "../../lib/bridge";
import { AUDIO_SPEEDS, voicesFor } from "../../lib/audioFormats";
import { PdfUiError } from "../../lib/pdfErrors";
import { errText } from "../../lib/projectError";
import { useProject } from "../../state/project";
import { useSettings } from "../../state/editorPrefs";

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
  const hearAudioSample = useProject((s) => s.actions.hearAudioSample);
  const cancelAudioSample = useProject((s) => s.actions.cancelAudioSample);
  const dismissAudio = useProject((s) => s.actions.dismissAudio);
  const downloadVoices = useProject((s) => s.actions.downloadVoices);
  const cancelVoiceDownload = useProject((s) => s.actions.cancelVoiceDownload);
  const dismissVoiceDownload = useProject((s) => s.actions.dismissVoiceDownload);
  const job = useProject((s) => s.audio);
  const download = useProject((s) => s.voiceDownload);
  const manifest = useProject((s) => s.manifest);
  const activeLanguage = useProject((s) => s.activeLanguage);
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [packs, setPacks] = useState<VoicePack[] | null>(null);
  const [getMore, setGetMore] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
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
  const [sample, setSample] = useState<"idle" | "making" | "playing">("idle");
  const player = useRef<{ el: HTMLAudioElement; url: string } | null>(null);
  const [audioChapters, setAudioChapters] = useState<string[] | null>(null);

  const refreshVoices = useCallback(
    async (isLive: () => boolean = () => true) => {
      try {
        const [list, found] = await Promise.all([bridge.audioVoices(), bridge.audioPacks()]);
        if (!isLive()) return;
        setVoices(list);
        setPacks(found);
      } catch (e) {
        if (!isLive()) return;
        setVoices([]);
        setPacks([]);
        setError(new PdfUiError("other", errText(e)));
      }
    },
    [setError],
  );
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
  const voice =
    (
      readers.find((v) => v.id === voiceFor[language]) ??
      readers.find((v) => v.id === useSettings.getState().audioVoice) ??
      readers[0]
    )?.id ?? "";
  const setVoice = (id: string) => setVoiceFor((m) => ({ ...m, [language]: id }));
  const pickEdition = (l: string) => {
    setEdition(l);
    setSkipUntranslated(false);
    setAudioChapters(null);
  };
  // Chapters (not matter) the edition has no translation of yet: they stop the export unless skipped.
  const untranslated = manifest
    ? manifest.chapters.filter((e) => !isTranslated(e, language, manifest.editions))
    : [];
  const blocked = untranslated.length > 0 && !skipUntranslated;
  const rows = manifest
    ? entryRowsIn(manifest.chapters, manifest.editions, language).filter(
        (r) => !skipUntranslated || r.translated,
      )
    : [];
  const missing = (packs ?? []).filter((p) => !p.installed);
  const hasVoices = (voices ?? []).some((v) => v.installed);
  const showDownload =
    !job &&
    voices !== null &&
    packs !== null &&
    (!hasVoices || getMore || download !== null) &&
    (missing.length > 0 || download !== null);
  const chosen =
    picked ?? (missing.some((p) => p.id === "piper") ? ["piper"] : missing.map((p) => p.id));
  const chosenPacks = missing.filter((p) => chosen.includes(p.id));
  const startDownload = () => {
    setError(null);
    void downloadVoices(chosenPacks).then((ok) => {
      if (ok) {
        setGetMore(false);
        setPicked(null);
        void refreshVoices();
      }
    });
  };

  const stopSample = useCallback(() => {
    const p = player.current;
    player.current = null;
    if (p) {
      p.el.pause();
      URL.revokeObjectURL(p.url);
    }
    setSample("idle");
  }, []);
  useEffect(
    () => () => {
      cancelAudioSample();
      stopSample();
    },
    [cancelAudioSample, stopSample],
  );
  const hear = async () => {
    if (sample === "playing") return stopSample();
    if (sample === "making") return cancelAudioSample();
    setError(null);
    setSample("making");
    try {
      const bytes = await hearAudioSample({
        voice,
        speed,
        language,
        skipUntranslated,
        ...(audioChapters ? { chapterIds: audioChapters } : {}),
      });
      if (!bytes) return setSample("idle");
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
      const el = new Audio(url);
      player.current = { el, url };
      el.onended = stopSample;
      el.onerror = stopSample;
      setSample("playing");
      await el.play();
    } catch (e) {
      stopSample();
      setError(new PdfUiError("other", errText(e)));
    }
  };
  const startAudio = () => {
    stopSample();
    setError(null);
    exportAudio({
      voice,
      speed,
      formats: audioFormats,
      language,
      skipUntranslated,
      ...(audioChapters ? { chapterIds: audioChapters } : {}),
    }).catch((e) => setError(new PdfUiError("other", errText(e))));
  };
  /** The dialog is closing: stop any sample, and (on Audiobook) clear a finished job or failed download. */
  const reset = (onAudiobook: boolean) => {
    cancelAudioSample();
    stopSample();
    setGetMore(false);
    if (onAudiobook) {
      dismissAudio();
      dismissVoiceDownload();
    }
  };
  /** The primary action of the form: start the download when voices are being offered, else the export. */
  const submit = () =>
    showDownload
      ? download?.status === "running" || chosenPacks.length === 0
        ? undefined
        : startDownload()
      : startAudio();

  return {
    job,
    download,
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
    audioChapters,
    setAudioChapters,
    sample,
    missing,
    hasVoices,
    showDownload,
    chosen,
    setPicked,
    chosenPacks,
    setGetMore,
    startDownload,
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

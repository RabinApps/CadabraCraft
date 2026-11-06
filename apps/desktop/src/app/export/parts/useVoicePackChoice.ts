import { useState } from "react";
import type { VoiceInfo } from "@cadabracraft/export-audio";
import type { VoicePack } from "../../../lib/bridge";
import type { PdfUiError } from "../../../lib/export/pdfErrors";
import { useProject } from "../../../state/project";

/**
 * The voice download step of the Audiobook format: which packs are missing, which the author ticked, whether the download
 * panel shows instead of the options, and the handler that starts the download.
 */
export function useVoicePackChoice({
  voices,
  packs,
  setError,
  refreshVoices,
}: {
  voices: VoiceInfo[] | null;
  packs: VoicePack[] | null;
  setError: (e: PdfUiError | null) => void;
  refreshVoices: () => Promise<void>;
}) {
  const downloadVoices = useProject((s) => s.actions.downloadVoices);
  const job = useProject((s) => s.audio);
  const download = useProject((s) => s.voiceDownload);
  const [getMore, setGetMore] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
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
  return {
    job,
    download,
    missing,
    hasVoices,
    showDownload,
    chosen,
    setPicked,
    chosenPacks,
    setGetMore,
    startDownload,
  };
}

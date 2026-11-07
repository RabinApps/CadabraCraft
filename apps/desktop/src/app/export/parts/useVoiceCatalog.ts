import { useCallback, useState } from "react";
import type { VoiceInfo } from "@cadabracraft/export-audio";
import { bridge, type VoicePack } from "../../../lib/bridge";
import { PdfUiError } from "../../../lib/export/pdfErrors";
import { errText } from "../../../lib/projectError";

/** The installed voices and the downloadable packs; `refreshVoices` reads them again (and ignores the answer when `isLive` is false). */
export function useVoiceCatalog(setError: (e: PdfUiError | null) => void) {
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [packs, setPacks] = useState<VoicePack[] | null>(null);
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
  return { voices, packs, refreshVoices };
}

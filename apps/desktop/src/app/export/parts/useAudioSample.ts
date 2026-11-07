import { useCallback, useEffect, useRef, useState } from "react";
import { PdfUiError } from "../../../lib/export/pdfErrors";
import { errText } from "../../../lib/projectError";
import { useProject } from "../../../state/project";

type SampleRequest = Parameters<
  ReturnType<typeof useProject.getState>["actions"]["hearAudioSample"]
>[0];

/** The "Hear a sample" player: makes a short clip of the book's voice, plays it, and stops it when the dialog goes away. */
export function useAudioSample(setError: (e: PdfUiError | null) => void) {
  const hearAudioSample = useProject((s) => s.actions.hearAudioSample);
  const cancelAudioSample = useProject((s) => s.actions.cancelAudioSample);
  const [sample, setSample] = useState<"idle" | "making" | "playing">("idle");
  const player = useRef<{ el: HTMLAudioElement; url: string } | null>(null);
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
  /** Stops the clip that is playing, cancels the one being made, or makes and plays a new one. */
  const hear = async (request: SampleRequest) => {
    if (sample === "playing") return stopSample();
    if (sample === "making") return cancelAudioSample();
    setError(null);
    setSample("making");
    try {
      const bytes = await hearAudioSample(request);
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
  return { sample, stopSample, hear, cancelAudioSample };
}

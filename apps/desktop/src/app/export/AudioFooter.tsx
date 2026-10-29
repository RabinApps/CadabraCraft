import { useLingui } from "@lingui/react/macro";
import { Download, Headphones, LoaderCircle, Play, Square } from "lucide-react";
import { mb } from "../../lib/audioFormats";
import { Button } from "../../ui/Button";
import type { AudioExport } from "./useAudioExport";

/** The buttons of the Audiobook format: they change with the voice download, the running job and the options. */
export function AudioFooter({
  audio,
  onClose,
  onKeepWorking,
}: {
  audio: AudioExport;
  /** Closes the dialog (after clearing what a closed dialog should not keep). */
  onClose: () => void;
  /** Closes the dialog while the export keeps running. */
  onKeepWorking: () => void;
}) {
  const { t } = useLingui();
  const {
    job,
    download,
    showDownload,
    hasVoices,
    chosenPacks,
    sample,
    voice,
    audioChapters,
    audioFormats,
  } = audio;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5">
      {showDownload ? (
        download?.status === "running" ? (
          <Button
            disabled={download.cancelling}
            onClick={audio.cancelVoiceDownload}
          >{t`Cancel download`}</Button>
        ) : download?.status === "error" ? (
          <>
            <Button
              onClick={() => {
                audio.dismissVoiceDownload();
                if (!hasVoices) onClose();
                else audio.setGetMore(false);
              }}
            >{t`Close`}</Button>
            <Button
              variant="primary"
              icon={Download}
              onClick={audio.startDownload}
            >{t`Try again`}</Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => (hasVoices ? audio.setGetMore(false) : onClose())}
            >{t`Cancel`}</Button>
            <Button
              type="submit"
              variant="primary"
              icon={Download}
              disabled={chosenPacks.length === 0}
            >{t`Download selected (${mb(chosenPacks.reduce((n, p) => n + p.bytes, 0))} MB)`}</Button>
          </>
        )
      ) : job?.status === "running" ? (
        <>
          <Button disabled={job.cancelling} onClick={audio.cancelAudio}>{t`Cancel export`}</Button>
          <Button variant="primary" onClick={onKeepWorking}>{t`Keep working`}</Button>
        </>
      ) : job?.status === "error" ? (
        <>
          <Button onClick={onClose}>{t`Close`}</Button>
          <Button variant="primary" onClick={audio.dismissAudio}>{t`Back to options`}</Button>
        </>
      ) : job ? (
        <Button variant="primary" onClick={onClose}>{t`Done`}</Button>
      ) : (
        <>
          <Button
            className="me-auto"
            icon={sample === "making" ? LoaderCircle : sample === "playing" ? Square : Play}
            disabled={!voice || audio.blocked || audioChapters?.length === 0}
            onClick={() => void audio.hear()}
          >
            {sample === "making"
              ? t`Making sample… (stop)`
              : sample === "playing"
                ? t`Stop sample`
                : t`Hear a sample`}
          </Button>
          <Button onClick={onClose}>{t`Cancel`}</Button>
          <Button
            type="submit"
            variant="primary"
            icon={Headphones}
            disabled={
              !voice ||
              audioFormats.length === 0 ||
              audio.rows.length === 0 ||
              audio.blocked ||
              audioChapters?.length === 0
            }
          >{t`Export audiobook`}</Button>
        </>
      )}
    </div>
  );
}

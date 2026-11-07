import { useLingui } from "@lingui/react/macro";
import { Download, Headphones, LoaderCircle, Play, Square } from "lucide-react";
import { mb } from "../../lib/audio/audioFormats";
import { Button } from "../../ui/Button";
import type { AudioExport } from "./useAudioExport";

type FooterProps = {
  audio: AudioExport;
  /** Closes the dialog (after clearing what a closed dialog should not keep). */
  onClose: () => void;
  /** Closes the dialog while the export keeps running. */
  onKeepWorking: () => void;
};

/** The buttons while the voice download step is showing. */
function DownloadButtons({ audio, onClose }: Pick<FooterProps, "audio" | "onClose">) {
  const { t } = useLingui();
  const { download, hasVoices, chosenPacks } = audio;
  if (download?.status === "running") {
    return (
      <Button
        disabled={download.cancelling}
        onClick={audio.cancelVoiceDownload}
      >{t`Cancel download`}</Button>
    );
  }
  if (download?.status === "error") {
    return (
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
    );
  }
  return (
    <>
      <Button onClick={() => (hasVoices ? audio.setGetMore(false) : onClose())}>{t`Cancel`}</Button>
      <Button
        type="submit"
        variant="primary"
        icon={Download}
        disabled={chosenPacks.length === 0}
      >{t`Download selected (${mb(chosenPacks.reduce((n, p) => n + p.bytes, 0))} MB)`}</Button>
    </>
  );
}

/** The buttons once an export job exists (running, failed or finished). */
function JobButtons({ audio, onClose, onKeepWorking }: FooterProps) {
  const { t } = useLingui();
  const { job } = audio;
  if (job?.status === "running") {
    return (
      <>
        <Button disabled={job.cancelling} onClick={audio.cancelAudio}>{t`Cancel export`}</Button>
        <Button variant="primary" onClick={onKeepWorking}>{t`Keep working`}</Button>
      </>
    );
  }
  if (job?.status === "error") {
    return (
      <>
        <Button onClick={onClose}>{t`Close`}</Button>
        <Button variant="primary" onClick={audio.dismissAudio}>{t`Back to options`}</Button>
      </>
    );
  }
  return <Button variant="primary" onClick={onClose}>{t`Done`}</Button>;
}

/** The sample button's icon. */
function sampleIcon(sample: AudioExport["sample"]) {
  if (sample === "making") return LoaderCircle;
  return sample === "playing" ? Square : Play;
}

/** The buttons of the options step. */
function OptionButtons({ audio, onClose }: Pick<FooterProps, "audio" | "onClose">) {
  const { t } = useLingui();
  const { sample, voice, audioChapters, audioFormats } = audio;
  const sampleLabel =
    sample === "making"
      ? t`Making sample… (stop)`
      : sample === "playing"
        ? t`Stop sample`
        : t`Hear a sample`;
  const cannotExport =
    !voice ||
    audioFormats.length === 0 ||
    audio.rows.length === 0 ||
    audio.blocked ||
    audioChapters?.length === 0;
  return (
    <>
      <Button
        className="me-auto"
        icon={sampleIcon(sample)}
        disabled={!voice || audio.blocked || audioChapters?.length === 0}
        onClick={() => void audio.hear()}
      >
        {sampleLabel}
      </Button>
      <Button onClick={onClose}>{t`Cancel`}</Button>
      <Button
        type="submit"
        variant="primary"
        icon={Headphones}
        disabled={cannotExport}
      >{t`Export audiobook`}</Button>
    </>
  );
}

/** The buttons of the Audiobook format: they change with the voice download, the running job and the options. */
export function AudioFooter(props: FooterProps) {
  const { audio, onClose } = props;
  let buttons;
  if (audio.showDownload) buttons = <DownloadButtons audio={audio} onClose={onClose} />;
  else if (audio.job) buttons = <JobButtons {...props} />;
  else buttons = <OptionButtons audio={audio} onClose={onClose} />;
  return <div className="flex flex-wrap items-center justify-end gap-2.5">{buttons}</div>;
}

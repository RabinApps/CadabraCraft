import { useProject } from "../../state/project";
import { AudioFields, AudioJobView, VoiceDownloadPanel } from "./AudioExport";
import type { AudioExport } from "./useAudioExport";

/** The Audiobook format: the running or finished job, the voice download offer, or the options. */
export function AudioPanel({ audio }: { audio: AudioExport }) {
  const chapters = useProject((s) => s.manifest)?.chapters ?? [];
  const { job, showDownload, missing, chosen, setPicked, download, hasVoices } = audio;
  if (job) return <AudioJobView job={job} />;
  if (showDownload) return <VoiceDownloadPanel packs={missing} picked={chosen} onPicked={setPicked} download={download} none={!hasVoices} />;
  return (
    <AudioFields
      voices={audio.voices} voice={audio.voice} onVoice={audio.setVoice} speed={audio.speed} onSpeed={audio.setSpeed}
      formats={audio.audioFormats} onFormats={audio.setAudioFormats} chapters={chapters} picked={audio.audioChapters} onPicked={audio.setAudioChapters}
      disabled={false} moreBytes={missing.reduce((n, p) => n + p.bytes, 0)} onMore={() => audio.setGetMore(true)}
    />
  );
}

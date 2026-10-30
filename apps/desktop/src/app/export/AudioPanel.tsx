import { translationProgress } from "@cadabracraft/format";
import { useProject } from "../../state/project";
import { AudioFields, AudioJobView, VoiceDownloadPanel } from "./AudioExport";
import type { AudioExport } from "./useAudioExport";

/** The Audiobook format: the running or finished job, the voice download offer, or the options. */
export function AudioPanel({ audio }: { audio: AudioExport }) {
  const book = useProject((s) => s.manifest);
  const { job, showDownload, missing, chosen, setPicked, download, hasVoices } = audio;
  if (job) return <AudioJobView job={job} />;
  if (showDownload)
    return (
      <VoiceDownloadPanel
        packs={missing}
        picked={chosen}
        onPicked={setPicked}
        download={download}
        none={!hasVoices}
      />
    );
  return (
    <AudioFields
      edition={
        book && book.editions.length > 1
          ? {
              editions: book.editions.map((e) => ({
                language: e.language,
                ...translationProgress(book, e.language),
              })),
              language: audio.language,
              onLanguage: audio.pickEdition,
              untranslated: audio.untranslated.map(
                (e) => e.titles[audio.language] ?? e.titles[book.editions[0]!.language] ?? e.id,
              ),
              skip: audio.skipUntranslated,
              onSkip: audio.setSkipUntranslated,
            }
          : undefined
      }
      voices={audio.readers}
      voice={audio.voice}
      onVoice={audio.setVoice}
      speed={audio.speed}
      onSpeed={audio.setSpeed}
      formats={audio.audioFormats}
      onFormats={audio.setAudioFormats}
      transcript={audio.transcript}
      onTranscript={audio.setTranscript}
      chapters={audio.rows}
      picked={audio.audioChapters}
      onPicked={audio.setAudioChapters}
      disabled={false}
      moreBytes={missing.reduce((n, p) => n + p.bytes, 0)}
      onMore={() => audio.setGetMore(true)}
    />
  );
}

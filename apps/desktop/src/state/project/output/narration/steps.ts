import type { Edition } from "@cadabracraft/format";
import { t } from "@lingui/core/macro";
import { chapterVtt, plainTranscript, type renderAudiobook } from "@cadabracraft/export-audio";
import { bridge } from "../../../../lib/bridge";
import {
  bookBase,
  chapterCaptionsPath,
  mapAudioError,
  transcriptPath,
} from "../../../../lib/audio/audioRunner";
import type { AudioChapterState, AudioJob } from "../../types";
import type { Ctx } from "../../context";
import { readAudioCache, saveAudioCache } from "./cache";

/** The M4B can only carry a PNG or JPEG cover; any other cover image (for example WebP) is left out. */
const isCoverImage = (path: string): boolean => /\.(png|jpe?g)$/i.test(path);

type Results = Awaited<ReturnType<typeof renderAudiobook>>;
type Callbacks = NonNullable<Parameters<typeof renderAudiobook>[3]>;

/** What one running audiobook export knows: the book's folder, its job and how to change the job shown in the store. */
export interface AudioRun {
  root: string;
  jobId: string;
  language: string;
  dir: string;
  edition: Edition;
  signal: AbortSignal;
  update: (fn: (j: AudioJob) => AudioJob) => void;
}

/** The job with chapter `i` patched. */
export const mark = (j: AudioJob, i: number, patch: Partial<AudioChapterState>) =>
  j.chapters.map((c, k) => (k === i ? { ...c, ...patch } : c));

/** Changes the job in the store (nothing when the job was dismissed). */
export const audioUpdater =
  (set: Ctx["set"]) =>
  (fn: (j: AudioJob) => AudioJob): void =>
    set((s) => (s.audio ? { audio: fn(s.audio) } : {}));

/** The render's progress hooks: reuse a chapter that is unchanged and still on disk, and show each chapter's state in the job. */
export const renderCallbacks = (run: AudioRun): Callbacks => {
  const { root, language, update } = run;
  const cacheKey = (id: string) => `${language}:${id}`;
  return {
    cached: async (id, hash) => {
      const hit = (await readAudioCache(root))[cacheKey(id)];
      if (!hit || hit.hash !== hash) return undefined;
      const paths = [...hit.files.map((f) => f.path), ...(hit.part ? [hit.part] : [])];
      const there = await bridge.audioFilesExist(root, paths).catch(() => []);
      return there.length === paths.length && there.every(Boolean)
        ? {
            files: hit.files,
            durationSec: hit.durationSec,
            ...(hit.part ? { part: hit.part } : {}),
            ...(hit.loudness ? { loudness: hit.loudness } : {}),
          }
        : undefined;
    },
    onChapterStart: (i) => update((j) => ({ ...j, chapters: mark(j, i, { state: "rendering" }) })),
    onProgress: (p) =>
      update((j) => ({
        ...j,
        overall: p.overall,
        chapters: mark(j, p.chapterIndex, { progress: p.fraction }),
      })),
    onChapterDone: (i, r) => {
      if (r.status === "done")
        void saveAudioCache(root, { ...r, id: cacheKey(r.id) }).catch(() => undefined);
      update((j) => ({
        ...j,
        durationSec: j.durationSec + r.durationSec,
        files: j.files + r.files.length,
        chapters: mark(j, i, {
          state: r.status === "empty" ? "empty" : "done",
          progress: 1,
        }),
      }));
    },
  };
};

/** Packs the rendered parts into one M4B audiobook. */
export const packM4b = async (run: AudioRun, results: Results): Promise<void> => {
  const { root, jobId, language, dir, edition, signal, update } = run;
  const chapters = results.flatMap((r) =>
    r.part ? [{ title: r.title, part: r.part, durationSec: r.durationSec }] : [],
  );
  if (chapters.length === 0)
    throw new Error(t`There is nothing to read aloud, so there is no audiobook to build.`);
  update((j) => ({ ...j, packing: true }));
  const stop = () => void bridge.audioCancel(jobId).catch(() => undefined);
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  try {
    const { cover } = edition;
    await bridge.audioBuildM4b({
      jobId,
      root,
      base: bookBase(dir, edition.title),
      title: edition.title,
      author: edition.author,
      cover: cover && isCoverImage(cover) ? cover : null,
      chapters,
      language,
    });
  } catch (e) {
    throw mapAudioError(e);
  } finally {
    signal.removeEventListener("abort", stop);
  }
  update((j) => ({ ...j, packing: false, files: j.files + 1 }));
};

/** Writes the whole-book transcript and one captions file per chapter that has text. */
export const writeTranscripts = async (run: AudioRun, results: Results): Promise<void> => {
  const { root, language, dir, edition, update } = run;
  // The text is what the voice was given for each chapter, so the transcript matches the audio.
  const read = results.filter((r) => r.chunks.length > 0);
  const saved: string[] = [];
  const save = async (path: string, contents: string) => {
    await bridge.audioWriteTranscript(root, path, contents);
    saved.push(path);
    update((j) => ({ ...j, transcripts: [...saved], files: j.files + 1 }));
  };
  try {
    await save(transcriptPath(dir, edition.title), plainTranscript(edition.title, read));
    for (const [i, r] of results.entries()) {
      if (r.chunks.length === 0) continue;
      await save(chapterCaptionsPath(dir, i, r.title), chapterVtt(r, language));
    }
  } catch (e) {
    throw mapAudioError(e);
  }
};

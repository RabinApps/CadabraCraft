import { t } from "@lingui/core/macro";
import {
  CancelledError,
  chunkBlocks,
  narrate,
  renderAudiobook,
  sampleChunks,
  type AudioFormat,
} from "@cadabracraft/export-audio";
import { bridge } from "../../lib/bridge";
import { bookBase, createTauriAudioRunner, mapAudioError } from "../../lib/audioRunner";
import { describeAudioError } from "../../lib/audioErrors";
import type { AudioChapterState, AudioJob, AudioActions } from "./types";
import type { Ctx } from "./context";

/** The M4B can only carry a PNG or JPEG cover; any other cover image (for example WebP) is left out. */
const isCoverImage = (path: string): boolean => /\.(png|jpe?g)$/i.test(path);

const AUDIO_CACHE = ".cadabra/audio/cache.json";
interface AudioCacheEntry {
  hash: string;
  files: { format: AudioFormat; path: string }[];
  durationSec: number;
  /** The lossless part kept for the M4B; a cached chapter is only reused while it is still on disk too. */
  part?: string;
}

/** The per-chapter audio cache: local to this computer (`.cadabra/`), never needed to open the book. A missing or damaged file is an empty cache. */
async function readAudioCache(root: string): Promise<Record<string, AudioCacheEntry>> {
  try {
    const f = await bridge.readFile(root, AUDIO_CACHE);
    const parsed: unknown = f ? JSON.parse(f.contents) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, AudioCacheEntry>)
      : {};
  } catch {
    return {};
  }
}

async function saveAudioCache(
  root: string,
  r: {
    id: string;
    hash: string;
    files: AudioCacheEntry["files"];
    durationSec: number;
    part?: string;
  },
): Promise<void> {
  const f = await bridge.readFile(root, AUDIO_CACHE).catch(() => null);
  const all = await readAudioCache(root);
  all[r.id] = {
    hash: r.hash,
    files: r.files,
    durationSec: r.durationSec,
    ...(r.part ? { part: r.part } : {}),
  };
  await bridge.writeFile(root, AUDIO_CACHE, JSON.stringify(all), f?.hash ?? null);
}

/** The audiobook export and the voice sample. The job lives in the store so the dialog can close while it runs. */
export const createAudioActions = (ctx: Ctx): AudioActions => {
  const { set, get, need, flush, loadChapters } = ctx;
  let audioAbort: AbortController | null = null;
  let sampleJob: string | null = null;
  return {
    async exportAudio(options) {
      if (get().audio?.status === "running" || get().exportStage)
        throw new Error(t`An export is already running`);
      await flush();
      const { root, manifest } = need();
      const pages = (await loadChapters()).filter(
        (p) =>
          p.section === "chapter" && (!options.chapterIds || options.chapterIds.includes(p.id)),
      );
      if (pages.length === 0)
        throw new Error(t`The book has no chapters to read aloud yet. Add a chapter first.`);
      const jobId = crypto.randomUUID();
      const ctrl = new AbortController();
      audioAbort = ctrl;
      const update = (fn: (j: AudioJob) => AudioJob) =>
        set((s) => (s.audio ? { audio: fn(s.audio) } : {}));
      const mark = (j: AudioJob, i: number, patch: Partial<AudioChapterState>) =>
        j.chapters.map((c, k) => (k === i ? { ...c, ...patch } : c));
      set({
        audio: {
          status: "running",
          chapters: pages.map((p) => ({ id: p.id, title: p.title, state: "waiting", progress: 0 })),
          overall: 0,
          cancelling: false,
          durationSec: 0,
          files: 0,
          packing: false,
          error: null,
        },
      });
      try {
        const results = await renderAudiobook(
          pages.map(({ id, title, doc }) => ({ id, title, doc })),
          { voice: options.voice, speed: options.speed, formats: options.formats },
          createTauriAudioRunner(bridge, root, jobId),
          {
            cached: async (id, hash) => {
              const hit = (await readAudioCache(root))[id];
              if (!hit || hit.hash !== hash) return undefined;
              const paths = [...hit.files.map((f) => f.path), ...(hit.part ? [hit.part] : [])];
              const there = await bridge.audioFilesExist(root, paths).catch(() => []);
              return there.length === paths.length && there.every(Boolean)
                ? {
                    files: hit.files,
                    durationSec: hit.durationSec,
                    ...(hit.part ? { part: hit.part } : {}),
                  }
                : undefined;
            },
            onChapterStart: (i) =>
              update((j) => ({ ...j, chapters: mark(j, i, { state: "rendering" }) })),
            onProgress: (p) =>
              update((j) => ({
                ...j,
                overall: p.overall,
                chapters: mark(j, p.chapterIndex, { progress: p.fraction }),
              })),
            onChapterDone: (i, r) => {
              if (r.status === "done") void saveAudioCache(root, r).catch(() => undefined);
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
          },
          ctrl.signal,
        );
        if (options.formats.includes("m4b")) {
          const chapters = results.flatMap((r) =>
            r.part ? [{ title: r.title, part: r.part, durationSec: r.durationSec }] : [],
          );
          if (chapters.length === 0)
            throw new Error(t`There is nothing to read aloud, so there is no audiobook to build.`);
          update((j) => ({ ...j, packing: true }));
          const stop = () => void bridge.audioCancel(jobId).catch(() => undefined);
          if (ctrl.signal.aborted) stop();
          else ctrl.signal.addEventListener("abort", stop, { once: true });
          try {
            await bridge.audioBuildM4b({
              jobId,
              root,
              base: bookBase(manifest.title),
              title: manifest.title,
              author: manifest.author,
              cover: manifest.cover && isCoverImage(manifest.cover) ? manifest.cover : null,
              chapters,
            });
          } catch (e) {
            throw mapAudioError(e);
          } finally {
            ctrl.signal.removeEventListener("abort", stop);
          }
          update((j) => ({ ...j, packing: false, files: j.files + 1 }));
        }
        update((j) => ({ ...j, status: "done", overall: 1 }));
        set({ notice: t`Exported the audiobook to exports/audio` });
      } catch (e) {
        const error = describeAudioError(e);
        update((j) => ({
          ...j,
          packing: false,
          status: "error",
          error,
          chapters:
            error.chapterIndex === undefined
              ? j.chapters
              : mark(j, error.chapterIndex, { state: "failed" }),
        }));
      } finally {
        audioAbort = null;
        bridge.audioForget(jobId).catch(() => undefined);
      }
    },
    async hearAudioSample(options) {
      if (sampleJob) throw new Error(t`A sample is already being made`);
      await flush();
      const pages = (await loadChapters()).filter(
        (p) =>
          p.section === "chapter" && (!options.chapterIds || options.chapterIds.includes(p.id)),
      );
      const first = pages[0];
      if (!first)
        throw new Error(t`The book has no chapters to read aloud yet. Add a chapter first.`);
      const chunks = sampleChunks(chunkBlocks(narrate(first.doc, first.title).blocks));
      if (chunks.length === 0) throw new Error(t`There is nothing to read aloud in this chapter.`);
      const jobId = crypto.randomUUID();
      sampleJob = jobId;
      try {
        return await bridge.audioSample({
          jobId,
          chunks,
          voice: options.voice,
          speed: options.speed,
        });
      } catch (e) {
        const mapped = mapAudioError(e);
        if (mapped instanceof CancelledError) return null;
        throw new Error(describeAudioError(mapped).message, { cause: e });
      } finally {
        sampleJob = null;
        bridge.audioForget(jobId).catch(() => undefined);
      }
    },
    cancelAudioSample() {
      if (sampleJob) void bridge.audioCancel(sampleJob).catch(() => undefined);
    },
    cancelAudio() {
      if (!audioAbort) return;
      set((s) => (s.audio ? { audio: { ...s.audio, cancelling: true } } : {}));
      audioAbort.abort();
    },
    dismissAudio() {
      if (get().audio?.status !== "running") set({ audio: null });
    },
  };
};

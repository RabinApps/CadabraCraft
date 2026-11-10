import { t } from "@lingui/core/macro";
import {
  CancelledError,
  chunkBlocks,
  narrate,
  renderAudiobook,
  sampleChunks,
} from "@cadabracraft/export-audio";
import { bridge } from "../../../lib/bridge";
import { audioDir, createTauriAudioRunner, mapAudioError } from "../../../lib/audio/audioRunner";
import { describeAudioError } from "../../../lib/audio/audioErrors";
import { summarizeLoudness } from "../../../lib/audio/loudnessReport";
import type { AudioActions } from "../types";
import type { Ctx } from "../context";
import { createPickChapters } from "./narration/pick";
import {
  audioUpdater,
  mark,
  packM4b,
  renderCallbacks,
  writeTranscripts,
  type AudioRun,
} from "./narration/steps";

/** The audiobook export and the voice sample. The job lives in the store so the dialog can close while it runs. */
export const createAudioActions = (ctx: Ctx): AudioActions => {
  const { set, get, need, flush } = ctx;
  const pickChapters = createPickChapters(ctx);
  let audioAbort: AbortController | null = null;
  let sampleJob: string | null = null;
  /** An export is being set up (before its running state is in the store): a second one is refused too. */
  let starting = false;
  return {
    async exportAudio(options) {
      if (starting || get().audio?.status === "running" || get().exportStage)
        throw new Error(t`An export is already running`);
      starting = true;
      let setup: { root: string };
      let picked: Awaited<ReturnType<typeof pickChapters>>;
      try {
        await flush();
        setup = need();
        picked = await pickChapters(options);
        if (picked.pages.length === 0)
          throw new Error(t`The book has no chapters to read aloud yet. Add a chapter first.`);
      } catch (e) {
        starting = false;
        throw e;
      }
      const { root } = setup;
      const { language, edition, pages } = picked;
      const dir = audioDir(language);
      const jobId = crypto.randomUUID();
      const ctrl = new AbortController();
      audioAbort = ctrl;
      const update = audioUpdater(set);
      const run: AudioRun = { root, jobId, language, dir, edition, signal: ctrl.signal, update };
      set({
        audio: {
          status: "running",
          chapters: pages.map((p) => ({ id: p.id, title: p.title, state: "waiting", progress: 0 })),
          overall: 0,
          cancelling: false,
          durationSec: 0,
          files: 0,
          transcripts: [],
          dir,
          packing: false,
          loudness: null,
          error: null,
        },
      });
      starting = false;
      try {
        const results = await renderAudiobook(
          pages.map(({ id, title, doc }) => ({ id, title, doc })),
          { voice: options.voice, speed: options.speed, formats: options.formats },
          createTauriAudioRunner(bridge, root, jobId, { language, dir }),
          renderCallbacks(run),
          ctrl.signal,
        );
        if (options.formats.includes("m4b")) await packM4b(run, results);
        if (options.transcript) await writeTranscripts(run, results);
        update((j) => ({ ...j, status: "done", overall: 1, loudness: summarizeLoudness(results) }));
        set({ notice: t`Exported the audiobook to ${dir}` });
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
      const { pages } = await pickChapters(options);
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

import { Channel, invoke } from "@tauri-apps/api/core";
import type { Chunk, RenderedChapter, VoiceInfo } from "@cadabracraft/export-audio";
import {
  binary,
  type AudioChapterRequest,
  type AudioM4bRequest,
  type RawBytes,
  type VoicePack,
} from "./types";

/** The local audiobook engine: voices, rendering, samples and voice downloads. */
export const audioBridge = {
  /** Voices the audio engine knows and whether their files are installed. */
  audioVoices: () => invoke<VoiceInfo[]>("audio_voices"),
  /** Renders one chapter off the UI thread; `onProgress` gets 0..1 after every batch. Rejects with an `AudioError` shape (`{ kind, ... }`). */
  audioRenderChapter: (
    request: AudioChapterRequest,
    onProgress: (fraction: number) => void,
  ): Promise<RenderedChapter> => {
    const channel = new Channel<number>();
    channel.onmessage = onProgress;
    return invoke<RenderedChapter>("audio_render_chapter", { request, onProgress: channel });
  },
  /** The voice packs, their download sizes and whether all their files are installed. */
  audioPacks: () => invoke<VoicePack[]>("audio_packs"),
  /** Downloads a voice pack (resuming a stopped download); `onProgress` gets the bytes of the whole pack. Stop it with `audioCancel(jobId)`. */
  audioDownloadPack: (
    pack: string,
    jobId: string,
    onProgress: (p: { done: number; total: number }) => void,
  ): Promise<void> => {
    const channel = new Channel<{ done: number; total: number }>();
    channel.onmessage = onProgress;
    return invoke<void>("audio_download_pack", { pack, jobId, onProgress: channel });
  },
  /** A short WAV of the given chunks, rendered off the UI thread and never written to the project. Stop it with `audioCancel(jobId)`. */
  audioSample: (request: {
    jobId: string;
    chunks: Chunk[];
    voice: string;
    speed: number;
  }): Promise<Uint8Array> => binary(invoke<RawBytes>("audio_sample", { request })),
  /** Builds the whole-book M4B from the chapters' parts (AAC through the bundled ffmpeg). Stop it with `audioCancel(jobId)`. */
  audioBuildM4b: (request: AudioM4bRequest) =>
    invoke<{ path: string; durationSec: number }>("audio_build_m4b", { request }),
  audioDeletePack: (pack: string) => invoke<void>("audio_delete_pack", { pack }),
  /** Stops the job's running chapter (the engine process is killed) and every later one. */
  audioCancel: (jobId: string) => invoke<void>("audio_cancel", { jobId }),
  /** Which of these project-relative files exist (for trusting the chapter cache). */
  audioFilesExist: (root: string, paths: string[]) =>
    invoke<boolean[]>("audio_files_exist", { root, paths }),
  /** Drops the job's cancel flag once an export has ended. */
  audioForget: (jobId: string) => invoke<void>("audio_forget", { jobId }),
};

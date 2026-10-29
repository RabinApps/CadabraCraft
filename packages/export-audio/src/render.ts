import type { ChapterDoc } from "@cadabracraft/shared";
import { errMsg } from "@cadabracraft/shared";
import { chunkBlocks, type Chunk } from "./chunk";
import {
  AudioExportError,
  CancelledError,
  ChapterRenderError,
  SynthesisError,
  VoiceNotInstalledError,
} from "./errors";
import { contentHash } from "./hash";
import { narrate } from "./narrate";

/** `m4b` is one file for the whole book (chapter markers, cover); the others are one file per chapter. */
export type AudioFormat = "opus" | "flac" | "wav" | "m4b";

export interface VoiceInfo {
  id: string;
  engine: "kokoro" | "piper";
  installed: boolean;
  /** Primary language subtags the voice reads (`en`), so a book edition is only offered voices that speak it. */
  languages: string[];
}

export interface AudioOptions {
  voice: string;
  /** 0.5 to 2; 1 is normal. */
  speed: number;
  formats: AudioFormat[];
  /** Render only these chapters (default: all). */
  chapterIds?: string[];
}

export interface AudioChapter {
  id: string;
  title: string;
  doc: ChapterDoc;
}

export interface RenderRequest {
  chapterId: string;
  chapterIndex: number;
  title: string;
  chunks: Chunk[];
  /** Cache key: changes when the text, voice, speed or formats change. */
  hash: string;
  voice: string;
  speed: number;
  formats: AudioFormat[];
}

export interface RenderedChapter {
  /** Paths relative to the book folder (for example `exports/audio/01-the-quay.opus`). */
  files: { format: AudioFormat; path: string }[];
  durationSec: number;
  /** The lossless part kept for the book's M4B (`.cadabra/audio/parts/<id>.flac`), when `m4b` was asked for. */
  part?: string;
}

/**
 * How audio is actually made. The orchestration (narration, chunking, validation, cache, order, cancel, errors) is
 * runtime-agnostic and works with any implementation: a Node one for tests and the MCP server, or the desktop app's
 * Tauri one, where synthesis and encoding run on a worker thread and never block the webview.
 *
 * Runners throw `AudioExportError` subclasses; anything else is wrapped in `SynthesisError`.
 */
export interface AudioRunner {
  listVoices(): Promise<VoiceInfo[]>;
  /** Render one chapter. Reports 0..1 progress and must stop promptly (throwing `CancelledError`) when `signal` aborts. */
  renderChapter(
    request: RenderRequest,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ): Promise<RenderedChapter>;
}

export interface ChapterResult extends RenderedChapter {
  id: string;
  title: string;
  /** `empty`: nothing to read aloud (for example a chapter of only images). `cached`: reused, not re-rendered. */
  status: "done" | "cached" | "empty";
  /** The cache key this chapter was rendered for. */
  hash: string;
  skipped: Record<string, number>;
}

export interface RenderHooks {
  /** Return a finished result for this hash to skip re-rendering (the per-chapter cache). */
  cached?(chapterId: string, hash: string): Promise<RenderedChapter | undefined>;
  onChapterStart?(index: number, total: number, title: string): void;
  onProgress?(p: { chapterIndex: number; total: number; fraction: number; overall: number }): void;
  onChapterDone?(index: number, result: ChapterResult): void;
}

function validate(options: AudioOptions): void {
  if (!(options.speed >= 0.5 && options.speed <= 2))
    throw new AudioExportError("Speed must be between 0.5 and 2.");
  if (options.formats.length === 0) throw new AudioExportError("Choose at least one audio format.");
  if (new Set(options.formats).size !== options.formats.length)
    throw new AudioExportError("Each audio format can be chosen once.");
}

/**
 * Renders the chapters one at a time (synthesis uses every core, so chapters do not run in parallel). Everything
 * that can fail before any audio is made (options, voice, unknown nodes) fails first, so a bad book is refused
 * before minutes of work. A failure in a chapter throws `ChapterRenderError`; finished chapters were already
 * reported through `onChapterDone` and stay on disk.
 */
export async function renderAudiobook(
  chapters: AudioChapter[],
  options: AudioOptions,
  runner: AudioRunner,
  hooks: RenderHooks = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<ChapterResult[]> {
  validate(options);
  if (signal.aborted) throw new CancelledError();
  const voice = (await runner.listVoices()).find((v) => v.id === options.voice);
  if (!voice?.installed) throw new VoiceNotInstalledError(options.voice);

  const picked = options.chapterIds
    ? chapters.filter((c) => options.chapterIds?.includes(c.id))
    : chapters;
  if (picked.length === 0)
    throw new AudioExportError("There are no chapters to turn into audio. Add a chapter first.");

  const plan = picked.map((c, chapterIndex) => {
    const { blocks, skipped } = narrate(c.doc, c.title);
    const chunks = chunkBlocks(blocks);
    const hash = contentHash(
      options.voice,
      String(options.speed),
      options.formats.join(","),
      ...chunks.map((k) => `${k.pauseAfterMs}:${k.text}`),
    );
    return { chapter: c, chapterIndex, chunks, hash, skipped };
  });

  const results: ChapterResult[] = [];
  for (const { chapter, chapterIndex, chunks, hash, skipped } of plan) {
    if (signal.aborted) throw new CancelledError();
    const total = plan.length;
    const report = (fraction: number) =>
      hooks.onProgress?.({
        chapterIndex,
        total,
        fraction,
        overall: (chapterIndex + fraction) / total,
      });
    hooks.onChapterStart?.(chapterIndex, total, chapter.title);
    let result: ChapterResult;
    if (chunks.length === 0) {
      result = {
        id: chapter.id,
        title: chapter.title,
        status: "empty",
        hash,
        files: [],
        durationSec: 0,
        skipped,
      };
    } else {
      try {
        const hit = await hooks.cached?.(chapter.id, hash);
        const rendered =
          hit ??
          (await runner.renderChapter(
            {
              chapterId: chapter.id,
              chapterIndex,
              title: chapter.title,
              chunks,
              hash,
              voice: options.voice,
              speed: options.speed,
              formats: options.formats,
            },
            report,
            signal,
          ));
        result = {
          id: chapter.id,
          title: chapter.title,
          status: hit ? "cached" : "done",
          hash,
          ...rendered,
          skipped,
        };
      } catch (e) {
        if (e instanceof CancelledError || signal.aborted) throw new CancelledError();
        throw new ChapterRenderError(
          chapterIndex,
          chapter.title,
          e instanceof AudioExportError ? e : new SynthesisError(errMsg(e)),
        );
      }
    }
    report(1);
    results.push(result);
    hooks.onChapterDone?.(chapterIndex, result);
  }
  return results;
}

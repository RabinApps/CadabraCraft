import type { ReadSentence } from "./sentenceList";

/** The silence after a sentence, and after the last sentence of a heading or paragraph. */
export const PAUSE_MS = { sentence: 250, block: 600 } as const;

/** One sentence to speak, with the silence after it. */
export interface SpeechRequest {
  text: string;
  pauseAfterMs: number;
}

export interface PlaybackOptions {
  /** Makes the WAV bytes of one sentence (the engine's sample call). Rejects on failure. */
  synthesize: (req: SpeechRequest) => Promise<Uint8Array>;
  /** Called with each sentence index as it starts playing. */
  onSentence: (index: number) => void;
  /** Called once the last sentence has finished. */
  onEnd: () => void;
  /** Called once when a sentence cannot be made or played. Playback is over. */
  onError: (e: unknown) => void;
}

export interface Playback {
  pause(): void;
  resume(): void;
  /** Ends playback at once and frees the clip. Nothing more is called back. */
  stop(): void;
}

/**
 * Plays the sentences from `startIndex` on, one WAV clip each. The next clip is made while the current one plays, so the
 * voice does not wait on the engine between sentences.
 */
export function startPlayback(
  sentences: readonly ReadSentence[],
  startIndex: number,
  opts: PlaybackOptions,
): Playback {
  const clips = new Map<number, Promise<Uint8Array>>();
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let paused = false;
  let stopped = false;

  const clip = (i: number): Promise<Uint8Array> => {
    let made = clips.get(i);
    if (!made) {
      const s = sentences[i]!;
      made = opts.synthesize({
        text: s.text,
        pauseAfterMs: s.endsBlock ? PAUSE_MS.block : PAUSE_MS.sentence,
      });
      clips.set(i, made);
      made.catch(() => undefined);
    }
    return made;
  };

  const release = () => {
    audio?.pause();
    audio = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
  };

  const fail = (e: unknown) => {
    if (stopped) return;
    stopped = true;
    release();
    opts.onError(e);
  };

  const play = async (i: number): Promise<void> => {
    if (stopped) return;
    if (i >= sentences.length) {
      stopped = true;
      release();
      opts.onEnd();
      return;
    }
    opts.onSentence(i);
    const current = clip(i);
    if (i + 1 < sentences.length) clip(i + 1);
    let bytes: Uint8Array;
    try {
      bytes = await current;
    } catch (e) {
      return fail(e);
    }
    if (stopped) return;
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
    const el = new Audio(url);
    audio = el;
    el.onended = () => {
      release();
      clips.delete(i);
      void play(i + 1);
    };
    el.onerror = () => fail(new Error("audio element failed"));
    if (!paused) {
      try {
        await el.play();
      } catch (e) {
        fail(e);
      }
    }
  };

  void play(startIndex);

  return {
    pause() {
      if (stopped) return;
      paused = true;
      audio?.pause();
    },
    resume() {
      if (stopped) return;
      paused = false;
      void audio?.play().catch(fail);
    },
    stop() {
      stopped = true;
      release();
    },
  };
}

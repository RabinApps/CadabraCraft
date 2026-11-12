import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAUSE_MS, startPlayback } from "../playback";
import type { ReadSentence } from "../sentenceList";

/** A stand-in for HTMLAudioElement: the test ends a clip by calling `onended` itself. */
class FakeAudio {
  static made: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  plays = 0;
  paused = false;
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

const sentence = (text: string, endsBlock: boolean): ReadSentence => ({
  from: 0,
  to: text.length,
  text,
  endsBlock,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

const created = () => FakeAudio.made;

describe("startPlayback", () => {
  const revoke = vi.fn();
  let n = 0;
  beforeEach(() => {
    FakeAudio.made = [];
    revoke.mockClear();
    vi.stubGlobal("Audio", FakeAudio);
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:clip-${++n}`),
      revokeObjectURL: revoke,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays each sentence in order, prefetching the next clip, and calls back at the end", async () => {
    const sentences = [sentence("One.", false), sentence("Two.", true)];
    const synthesize = vi.fn(async () => new Uint8Array([1, 2]));
    const onSentence = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    startPlayback(sentences, 0, { synthesize, onSentence, onEnd, onError });
    await flush();
    expect(synthesize).toHaveBeenNthCalledWith(1, {
      text: "One.",
      pauseAfterMs: PAUSE_MS.sentence,
    });
    expect(synthesize).toHaveBeenNthCalledWith(2, {
      text: "Two.",
      pauseAfterMs: PAUSE_MS.block,
    });
    expect(onSentence).toHaveBeenLastCalledWith(0);
    expect(created()).toHaveLength(1);
    created()[0]!.onended!();
    await flush();
    expect(onSentence).toHaveBeenLastCalledWith(1);
    expect(created()).toHaveLength(2);
    created()[1]!.onended!();
    await flush();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalled();
  });

  it("pauses the clip and resumes it without moving to the next sentence", async () => {
    const onSentence = vi.fn();
    const playback = startPlayback([sentence("One.", true)], 0, {
      synthesize: async () => new Uint8Array([1]),
      onSentence,
      onEnd: vi.fn(),
      onError: vi.fn(),
    });
    await flush();
    playback.pause();
    expect(created()[0]!.paused).toBe(true);
    playback.resume();
    await flush();
    expect(created()[0]!.plays).toBe(2);
    expect(onSentence).toHaveBeenCalledTimes(1);
  });

  it("stops at once: no more callbacks and the clip is freed", async () => {
    const onEnd = vi.fn();
    const playback = startPlayback([sentence("One.", true)], 0, {
      synthesize: async () => new Uint8Array([1]),
      onSentence: vi.fn(),
      onEnd,
      onError: vi.fn(),
    });
    await flush();
    playback.stop();
    created()[0]!.onended!();
    await flush();
    expect(onEnd).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:clip-" + n);
  });

  it("reports a failed sentence once and ends", async () => {
    const onError = vi.fn();
    const failure = new Error("engine broke");
    startPlayback([sentence("One.", true)], 0, {
      synthesize: () => Promise.reject(failure),
      onSentence: vi.fn(),
      onEnd: vi.fn(),
      onError,
    });
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  const opts = (over: Partial<Parameters<typeof startPlayback>[2]> = {}) => ({
    synthesize: async () => new Uint8Array([1]),
    onSentence: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
    ...over,
  });

  it("drops a clip that arrives after stop", async () => {
    let finish!: (b: Uint8Array) => void;
    const slow = new Promise<Uint8Array>((r) => (finish = r));
    const playback = startPlayback([sentence("One.", true)], 0, opts({ synthesize: () => slow }));
    playback.stop();
    finish(new Uint8Array([1]));
    await flush();
    expect(created()).toHaveLength(0);
  });

  it("makes a clip but does not play it while paused before it arrived", async () => {
    let finish!: (b: Uint8Array) => void;
    const slow = new Promise<Uint8Array>((r) => (finish = r));
    const playback = startPlayback([sentence("One.", true)], 0, opts({ synthesize: () => slow }));
    playback.pause();
    finish(new Uint8Array([1]));
    await flush();
    expect(created()[0]!.plays).toBe(0);
    playback.resume();
    await flush();
    expect(created()[0]!.plays).toBe(1);
  });

  it("reports a clip that cannot play and a clip that errors, once", async () => {
    const onError = vi.fn();
    vi.spyOn(FakeAudio.prototype, "play").mockRejectedValueOnce(new Error("blocked"));
    startPlayback([sentence("One.", true)], 0, opts({ onError }));
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    created()[0]!.onerror!();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports a clip element that errors", async () => {
    const onError = vi.fn();
    startPlayback([sentence("One.", true)], 0, opts({ onError }));
    await flush();
    created()[0]!.onerror!();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports a resume that the platform refuses, and ignores pause and resume after stop", async () => {
    const onError = vi.fn();
    const playback = startPlayback([sentence("One.", true)], 0, opts({ onError }));
    await flush();
    playback.pause();
    vi.spyOn(FakeAudio.prototype, "play").mockRejectedValueOnce(new Error("refused"));
    playback.resume();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    playback.pause();
    playback.resume();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("ignores pause and resume once it has been stopped", async () => {
    const playback = startPlayback([sentence("One.", true)], 0, opts());
    await flush();
    playback.stop();
    const clipPlays = created()[0]!.plays;
    playback.pause();
    playback.resume();
    expect(created()[0]!.plays).toBe(clipPlays);
  });
});

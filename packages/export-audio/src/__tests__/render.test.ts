import type { ChapterDoc } from "@cadabracraft/shared";
import { describe, expect, it, vi } from "vitest";
import {
  AudioExportError,
  CancelledError,
  ChapterRenderError,
  DiskFullError,
  SynthesisError,
  VoiceNotInstalledError,
} from "../errors";
import {
  renderAudiobook,
  type AudioChapter,
  type AudioOptions,
  type AudioRunner,
  type RenderRequest,
} from "../render";

const doc = (text: string): ChapterDoc => ({
  type: "doc",
  content: text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [],
});
const book: AudioChapter[] = [
  { id: "a", title: "One", doc: doc("First chapter.") },
  { id: "b", title: "Two", doc: doc("Second chapter.") },
  { id: "c", title: "Three", doc: doc("Third chapter.") },
];
const options: AudioOptions = { voice: "kokoro", speed: 1, formats: ["opus"] };

function fakeRunner(over: Partial<AudioRunner> = {}): AudioRunner & { requests: RenderRequest[] } {
  const requests: RenderRequest[] = [];
  return {
    requests,
    listVoices: async () => [
      { id: "kokoro", engine: "kokoro", installed: true, languages: ["en"] },
    ],
    renderChapter: async (req, onProgress) => {
      requests.push(req);
      onProgress(0.5);
      return {
        files: [{ format: "opus", path: `exports/audio/${req.chapterId}.opus` }],
        durationSec: 10,
      };
    },
    ...over,
  };
}

describe("renderAudiobook", () => {
  it("carries each chapter's loudness report through to its result", async () => {
    const loudness = { integratedLufs: -19.2, truePeakDbtp: -3.4, targetLufs: -19, passed: true };
    const runner = fakeRunner({
      renderChapter: async (req) => ({
        files: [{ format: "opus", path: `exports/audio/${req.chapterId}.opus` }],
        durationSec: 10,
        loudness,
      }),
    });
    const results = await renderAudiobook(book, options, runner, {});
    expect(results.every((r) => r.loudness?.passed === true)).toBe(true);
    expect(results[0]?.loudness).toEqual(loudness);
  });

  it("renders chapters in order and reports progress and results", async () => {
    const runner = fakeRunner();
    const progress: number[] = [];
    const done: string[] = [];
    const results = await renderAudiobook(book, options, runner, {
      onProgress: (p) => progress.push(p.overall),
      onChapterDone: (_, r) => done.push(r.id),
    });
    expect(runner.requests.map((r) => r.chapterId)).toEqual(["a", "b", "c"]);
    expect(results.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(done).toEqual(["a", "b", "c"]);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((x, y) => x - y));
  });

  it("refuses bad options before any rendering", async () => {
    const runner = fakeRunner();
    await expect(renderAudiobook(book, { ...options, speed: 3 }, runner)).rejects.toThrow(
      AudioExportError,
    );
    await expect(renderAudiobook(book, { ...options, formats: [] }, runner)).rejects.toThrow(
      /at least one/,
    );
    await expect(
      renderAudiobook(book, { ...options, formats: ["opus", "opus"] }, runner),
    ).rejects.toThrow(/once/);
    await expect(renderAudiobook([], options, runner)).rejects.toThrow(/no chapters/);
    expect(runner.requests).toEqual([]);
  });

  it("refuses a voice that is not installed", async () => {
    const runner = fakeRunner({
      listVoices: async () => [
        { id: "kokoro", engine: "kokoro", installed: false, languages: ["en"] },
      ],
    });
    await expect(renderAudiobook(book, options, runner)).rejects.toThrow(VoiceNotInstalledError);
    await expect(
      renderAudiobook(book, { ...options, voice: "nope" }, fakeRunner()),
    ).rejects.toThrow(VoiceNotInstalledError);
  });

  it("fails on an unknown node before rendering anything", async () => {
    const runner = fakeRunner();
    const bad = {
      id: "x",
      title: "Bad",
      doc: { type: "doc", content: [{ type: "mystery" }] } as unknown as ChapterDoc,
    };
    await expect(renderAudiobook([book[0]!, bad], options, runner)).rejects.toThrow(/mystery/);
    expect(runner.requests).toEqual([]);
  });

  it("renders only the chosen chapters", async () => {
    const runner = fakeRunner();
    await renderAudiobook(book, { ...options, chapterIds: ["c", "a"] }, runner);
    expect(runner.requests.map((r) => r.chapterId)).toEqual(["a", "c"]);
  });

  it("marks a chapter with nothing to read as empty and keeps going", async () => {
    const runner = fakeRunner();
    const results = await renderAudiobook(
      [{ id: "e", title: "", doc: doc("") }, book[0]!],
      options,
      runner,
    );
    expect(results.map((r) => r.status)).toEqual(["empty", "done"]);
    expect(runner.requests).toHaveLength(1);
  });

  it("reuses a cached chapter and uses a different hash when voice, speed or formats change", async () => {
    const runner = fakeRunner();
    const cached = vi.fn(async (id: string) =>
      id === "a"
        ? { files: [{ format: "opus" as const, path: "exports/audio/a.opus" }], durationSec: 5 }
        : undefined,
    );
    const results = await renderAudiobook(book, options, runner, { cached });
    expect(results.map((r) => r.status)).toEqual(["cached", "done", "done"]);
    expect(runner.requests.map((r) => r.chapterId)).toEqual(["b", "c"]);
    // Every result, cached or not, carries the text that was (or would have been) given to the voice.
    expect(results.map((r) => r.chunks.map((c) => c.text))).toEqual([
      ["One", "First chapter."],
      ["Two", "Second chapter."],
      ["Three", "Third chapter."],
    ]);
    expect(results[1]?.chunks).toEqual(runner.requests[0]?.chunks);
    const slow = fakeRunner();
    await renderAudiobook(book, { ...options, speed: 1.1 }, slow);
    expect(slow.requests[0]?.hash).not.toBe(runner.requests[0]?.hash);
  });

  it("wraps a failure with the chapter and keeps earlier chapters reported", async () => {
    const done: string[] = [];
    const runner = fakeRunner({
      renderChapter: async (req) => {
        if (req.chapterIndex === 1) throw new DiskFullError();
        return { files: [], durationSec: 1 };
      },
    });
    const err = await renderAudiobook(book, options, runner, {
      onChapterDone: (_, r) => done.push(r.id),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ChapterRenderError);
    expect(err.chapterIndex).toBe(1);
    expect(err.cause).toBeInstanceOf(DiskFullError);
    expect(done).toEqual(["a"]);
  });

  it("wraps a plain error from the runner as a synthesis error", async () => {
    const runner = fakeRunner({ renderChapter: async () => Promise.reject(new Error("segfault")) });
    const err = await renderAudiobook(book, options, runner).catch((e) => e);
    expect(err.cause).toBeInstanceOf(SynthesisError);
    expect(err.message).toContain("segfault");
  });

  it("stops on cancel, between chapters and inside one, without wrapping it", async () => {
    const ctl = new AbortController();
    const runner = fakeRunner();
    const err = await renderAudiobook(
      book,
      options,
      runner,
      { onChapterDone: () => ctl.abort() },
      ctl.signal,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(CancelledError);
    expect(runner.requests).toHaveLength(1);
    const inner = fakeRunner({ renderChapter: async () => Promise.reject(new CancelledError()) });
    await expect(renderAudiobook(book, options, inner)).rejects.toBeInstanceOf(CancelledError);
    const before = new AbortController();
    before.abort();
    await expect(
      renderAudiobook(book, options, fakeRunner(), {}, before.signal),
    ).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("contents page", () => {
  const contents: AudioChapter = {
    id: "toc",
    title: "Contents",
    kind: "contents",
    doc: doc("Contents"),
  };

  it("is skipped by kind: never narrated, not in the results, other pages unchanged", async () => {
    const runner = fakeRunner();
    const results = await renderAudiobook([contents, ...book], options, runner);
    expect(runner.requests.map((r) => r.chapterId)).toEqual(["a", "b", "c"]);
    expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
    // indexes and cache keys match a book without the page
    const plain = fakeRunner();
    await renderAudiobook(book, options, plain);
    expect(runner.requests).toEqual(plain.requests);
  });

  it("is skipped even when picked by id, and a book with only that page has nothing to render", async () => {
    const runner = fakeRunner();
    await renderAudiobook([contents, ...book], { ...options, chapterIds: ["toc", "b"] }, runner);
    expect(runner.requests.map((r) => r.chapterId)).toEqual(["b"]);
    await expect(
      renderAudiobook([contents], { ...options, chapterIds: ["toc"] }, fakeRunner()),
    ).rejects.toThrow(/no chapters/);
  });

  it("does not hide unknown nodes in other pages, and a page of another kind is still narrated", async () => {
    const bad: AudioChapter = {
      id: "bad",
      title: "Bad",
      kind: "preface",
      doc: { type: "doc", content: [{ type: "mystery" }] } as unknown as ChapterDoc,
    };
    const runner = fakeRunner();
    await expect(renderAudiobook([contents, bad], options, runner)).rejects.toThrow(/mystery/);
    expect(runner.requests).toEqual([]);
    const ok = fakeRunner();
    await renderAudiobook([{ ...book[0]!, kind: "preface" }], options, ok);
    expect(ok.requests.map((r) => r.chapterId)).toEqual(["a"]);
  });
});

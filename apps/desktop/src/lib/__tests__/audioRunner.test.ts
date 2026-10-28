import { describe, expect, it, vi } from "vitest";
import {
  AudioTimeoutError,
  CancelledError,
  DiskFullError,
  DownloadError,
  EncodeError,
  EngineNotFoundError,
  SynthesisError,
  VoiceNotInstalledError,
} from "@cadabracraft/export-audio";
import { chapterBase, createTauriAudioRunner, mapAudioError } from "../audioRunner";

describe("mapAudioError", () => {
  it("maps every error shape the Rust side sends", () => {
    expect(mapAudioError({ kind: "not_found", message: "x" })).toBeInstanceOf(EngineNotFoundError);
    expect(mapAudioError({ kind: "voice_missing", voice: "v" })).toBeInstanceOf(
      VoiceNotInstalledError,
    );
    expect(mapAudioError({ kind: "synth", message: "boom" })).toBeInstanceOf(SynthesisError);
    expect(mapAudioError({ kind: "encode", format: "flac", message: "m" })).toBeInstanceOf(
      EncodeError,
    );
    expect(mapAudioError({ kind: "disk_full" })).toBeInstanceOf(DiskFullError);
    expect(mapAudioError({ kind: "timeout", seconds: 900 })).toMatchObject({ seconds: 900 });
    expect(mapAudioError({ kind: "timeout", seconds: 900 })).toBeInstanceOf(AudioTimeoutError);
    expect(mapAudioError({ kind: "cancelled" })).toBeInstanceOf(CancelledError);
    expect(mapAudioError({ kind: "download", message: "503" })).toBeInstanceOf(DownloadError);
    expect(mapAudioError({ kind: "checksum", file: "m.onnx" })).toMatchObject({ file: "m.onnx" });
    expect(mapAudioError({ kind: "other", message: "odd" }).message).toBe("odd");
    expect(mapAudioError(new Error("plain")).message).toBe("plain");
    const known = new DiskFullError();
    expect(mapAudioError(known)).toBe(known);
  });
});

describe("chapterBase", () => {
  it("numbers chapters and makes a safe ASCII slug", () => {
    expect(chapterBase(0, "The Quay")).toBe("exports/audio/01-the-quay");
    expect(chapterBase(11, "Café: ünder/the \\ sea?")).toBe("exports/audio/12-cafe-under-the-sea");
    expect(chapterBase(2, "日本語")).toBe("exports/audio/03-chapter");
    expect(chapterBase(0, "a".repeat(80))).toBe(`exports/audio/01-${"a".repeat(40)}`);
  });
});

describe("createTauriAudioRunner", () => {
  const req = {
    chapterId: "c",
    chapterIndex: 1,
    title: "Two",
    chunks: [{ text: "Hi.", pauseAfterMs: 600 }],
    hash: "h",
    voice: "piper-amy",
    speed: 1,
    formats: ["opus" as const],
  };
  const rendered = { files: [], durationSec: 1 };

  it("sends the chapter with its job, root and output path, and forwards progress", async () => {
    const audioRenderChapter = vi.fn(async (_r: unknown, onProgress: (f: number) => void) => {
      onProgress(0.4);
      return rendered;
    });
    const runner = createTauriAudioRunner(
      { audioVoices: async () => [], audioRenderChapter, audioCancel: async () => {} },
      "/book",
      "job1",
    );
    const seen: number[] = [];
    await runner.renderChapter(req, (f) => seen.push(f), new AbortController().signal);
    expect(audioRenderChapter.mock.calls[0]![0]).toEqual({
      jobId: "job1",
      root: "/book",
      base: "exports/audio/02-two",
      chunks: req.chunks,
      voice: "piper-amy",
      speed: 1,
      formats: ["opus"],
    });
    expect(seen).toEqual([0.4]);
  });

  it("asks Rust to cancel when the signal aborts, and maps what comes back", async () => {
    let reject: (e: unknown) => void = () => {};
    const audioCancel = vi.fn(async () => {
      reject({ kind: "cancelled" });
    });
    const runner = createTauriAudioRunner(
      {
        audioVoices: async () => [],
        audioRenderChapter: () =>
          new Promise((_, r) => {
            reject = r;
          }),
        audioCancel,
      },
      "/book",
      "job2",
    );
    const ctl = new AbortController();
    const done = runner.renderChapter(req, () => {}, ctl.signal);
    ctl.abort();
    await expect(done).rejects.toBeInstanceOf(CancelledError);
    expect(audioCancel).toHaveBeenCalledWith("job2");
  });

  it("cancels at once when the signal is already aborted, and maps voice listing errors", async () => {
    const audioCancel = vi.fn(async () => {});
    const ctl = new AbortController();
    ctl.abort();
    const runner = createTauriAudioRunner(
      {
        audioVoices: async () => {
          throw { kind: "not_found", message: "gone" };
        },
        audioRenderChapter: async () => rendered,
        audioCancel,
      },
      "/b",
      "j",
    );
    await runner.renderChapter(req, () => {}, ctl.signal);
    expect(audioCancel).toHaveBeenCalledWith("j");
    await expect(runner.listVoices()).rejects.toBeInstanceOf(EngineNotFoundError);
  });
});

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
import {
  audioDir,
  bookBase,
  chapterBase,
  chapterPart,
  createTauriAudioRunner,
  mapAudioError,
} from "../audioRunner";

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

describe("audioDir", () => {
  it("is exports/<language>/audio, beside the edition's other exports", () => {
    expect(audioDir("en")).toBe("exports/en/audio");
    expect(audioDir("pt-BR")).toBe("exports/pt-BR/audio");
    expect(() => audioDir("../x")).toThrow();
  });
});

describe("chapterBase", () => {
  const dir = "exports/fr/audio";
  it("numbers chapters and makes a safe ASCII slug", () => {
    expect(chapterBase(dir, 0, "The Quay")).toBe("exports/fr/audio/01-the-quay");
    expect(chapterBase(dir, 11, "Café: ünder/the \\ sea?")).toBe(
      "exports/fr/audio/12-cafe-under-the-sea",
    );
    expect(chapterBase(dir, 2, "日本語")).toBe("exports/fr/audio/03-chapter");
    expect(chapterBase(dir, 0, "a".repeat(80))).toBe(`exports/fr/audio/01-${"a".repeat(40)}`);
  });
});

describe("bookBase and chapterPart", () => {
  it("name the book file and the chapter part with characters the Rust side accepts", () => {
    expect(bookBase("exports/en/audio", "My Book: Part 1")).toBe("exports/en/audio/my-book-part-1");
    expect(bookBase("exports/en/audio", "???")).toBe("exports/en/audio/audiobook");
    expect(chapterPart("", "")).toBe(".cadabra/audio/parts/x_chapter.flac");
    expect(chapterPart("en", "ch-1")).toBe(".cadabra/audio/parts/en_ch-1.flac");
    expect(chapterPart("en", "a b/../c")).toBe(".cadabra/audio/parts/en_a_b_c.flac");
    expect(chapterPart("en", "???")).toBe(".cadabra/audio/parts/en__.flac");
  });
  it("keeps the editions of one chapter apart", () => {
    expect(chapterPart("fr", "c")).not.toBe(chapterPart("en", "c"));
    expect(chapterPart("pt-BR", "c")).toBe(".cadabra/audio/parts/pt-BR_c.flac");
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
  const edition = { language: "en", dir: "exports/en/audio" };

  it("sends the chapter with its job, root and output path, and forwards progress", async () => {
    const audioRenderChapter = vi.fn(async (_r: unknown, onProgress: (f: number) => void) => {
      onProgress(0.4);
      return rendered;
    });
    const runner = createTauriAudioRunner(
      { audioVoices: async () => [], audioRenderChapter, audioCancel: async () => {} },
      "/book",
      "job1",
      edition,
    );
    const seen: number[] = [];
    await runner.renderChapter(req, (f) => seen.push(f), new AbortController().signal);
    expect(audioRenderChapter.mock.calls[0]![0]).toEqual({
      jobId: "job1",
      root: "/book",
      base: "exports/en/audio/02-two",
      chunks: req.chunks,
      voice: "piper-amy",
      speed: 1,
      formats: ["opus"],
    });
    expect(seen).toEqual([0.4]);
  });

  it("never asks for an m4b file per chapter: it asks for a lossless part instead", async () => {
    const audioRenderChapter = vi.fn(async (_r: unknown) => rendered);
    const runner = createTauriAudioRunner(
      { audioVoices: async () => [], audioRenderChapter, audioCancel: async () => {} },
      "/book",
      "job1",
      edition,
    );
    const out = await runner.renderChapter(
      { ...req, formats: ["opus" as const, "m4b" as const] },
      () => {},
      new AbortController().signal,
    );
    expect(audioRenderChapter.mock.calls[0]![0]).toMatchObject({
      formats: ["opus"],
      part: ".cadabra/audio/parts/en_c.flac",
    });
    expect(out.part).toBe(".cadabra/audio/parts/en_c.flac");
    await runner.renderChapter(req, () => {}, new AbortController().signal);
    expect(audioRenderChapter.mock.calls[1]![0]).not.toHaveProperty("part");
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
      edition,
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
      edition,
    );
    await runner.renderChapter(req, () => {}, ctl.signal);
    expect(audioCancel).toHaveBeenCalledWith("j");
    await expect(runner.listVoices()).rejects.toBeInstanceOf(EngineNotFoundError);
  });

  it("ignores a failing cancel: the render result still decides the outcome", async () => {
    const audioCancel = vi.fn(async () => {
      throw new Error("ipc closed");
    });
    const ctl = new AbortController();
    ctl.abort();
    const runner = createTauriAudioRunner(
      { audioVoices: async () => [], audioRenderChapter: async () => rendered, audioCancel },
      "/b",
      "j",
      edition,
    );
    await expect(runner.renderChapter(req, () => {}, ctl.signal)).resolves.toBeDefined();
    await Promise.resolve();
    expect(audioCancel).toHaveBeenCalled();
  });
});

describe("chapterPart edge cases", () => {
  it("falls back to chapter for an empty id", () => {
    expect(chapterPart("en", "")).toBe(".cadabra/audio/parts/en_chapter.flac");
    expect(chapterPart("en", "a b/c")).toBe(".cadabra/audio/parts/en_a_b_c.flac");
  });
});

describe("a second edition", () => {
  it("writes under its own language folder with its own part", async () => {
    const audioRenderChapter = vi.fn(async (_r: unknown) => ({ files: [], durationSec: 1 }));
    const runner = createTauriAudioRunner(
      { audioVoices: async () => [], audioRenderChapter, audioCancel: async () => {} },
      "/book",
      "job",
      { language: "fr", dir: audioDir("fr") },
    );
    await runner.renderChapter(
      {
        chapterId: "c",
        chapterIndex: 0,
        title: "Un",
        chunks: [],
        hash: "h",
        voice: "v",
        speed: 1,
        formats: ["m4b" as const],
      },
      () => {},
      new AbortController().signal,
    );
    expect(audioRenderChapter.mock.calls[0]![0]).toMatchObject({
      base: "exports/fr/audio/01-un",
      part: ".cadabra/audio/parts/fr_c.flac",
    });
  });
});

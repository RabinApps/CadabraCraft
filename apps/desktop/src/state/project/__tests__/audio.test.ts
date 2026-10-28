import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

// Fake bridge: an in-memory project plus a fake audio engine behind the same bridge methods the app uses.
const audio = {
  voices: [{ id: "piper-amy", engine: "piper", installed: true }] as {
    id: string;
    engine: string;
    installed: boolean;
  }[],
  requests: [] as {
    jobId: string;
    base: string;
    voice: string;
    formats: string[];
    speed: number;
    chunks: { text: string }[];
  }[],
  /** Files that exist on the fake disk; filled by renders unless a test removes them. */
  present: new Set<string>(),
  samples: [] as { jobId: string; chunks: { text: string }[]; voice: string; speed: number }[],
  sample: null as null | ((req: { jobId: string }) => Promise<Uint8Array>),
  cancelled: [] as string[],
  forgotten: [] as string[],
  /** Decides what a chapter render does; set per test. */
  render: null as
    null | ((req: { base: string }, onProgress: (f: number) => void) => Promise<unknown>),
  /** Decides what a pack download does; set per test. */
  download: null as
    | null
    | ((pack: string, onProgress: (p: { done: number; total: number }) => void) => Promise<void>),
  downloads: [] as string[],
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    audioVoices: async () => audio.voices,
    audioRenderChapter: async (
      req: (typeof audio.requests)[number],
      onProgress: (f: number) => void,
    ) => {
      audio.requests.push(req);
      if (audio.render) return audio.render(req, onProgress);
      onProgress(0.5);
      const files = req.formats.map((format) => ({ format, path: `${req.base}.${format}` }));
      files.forEach((f) => audio.present.add(f.path));
      return { files, durationSec: 90 };
    },
    audioSample: async (req: {
      jobId: string;
      chunks: { text: string }[];
      voice: string;
      speed: number;
    }) => {
      audio.samples.push(req);
      if (audio.sample) return audio.sample(req);
      return new Uint8Array([1, 2, 3]);
    },
    audioFilesExist: async (_r: string, paths: string[]) => paths.map((p) => audio.present.has(p)),
    audioDownloadPack: async (
      pack: string,
      _jobId: string,
      onProgress: (p: { done: number; total: number }) => void,
    ) => {
      audio.downloads.push(pack);
      if (audio.download) return audio.download(pack, onProgress);
      onProgress({ done: 50, total: 100 });
    },
    audioCancel: async (id: string) => {
      audio.cancelled.push(id);
    },
    audioForget: async (id: string) => {
      audio.forgotten.push(id);
    },
  }),
);

import { AudioUiError } from "../../../lib/audioErrors";
import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const options = { voice: "piper-amy", speed: 1.1, formats: ["opus" as const, "flac" as const] };

beforeEach(async () => {
  disk.clear();
  audio.voices = [{ id: "piper-amy", engine: "piper", installed: true }];
  audio.requests = [];
  audio.cancelled = [];
  audio.samples = [];
  audio.sample = null;
  audio.present = new Set();
  audio.forgotten = [];
  audio.render = null;
  audio.download = null;
  audio.downloads = [];
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    exportStage: null,
    audio: null,
    voiceDownload: null,
  });
  await a().createProject("/p", "Book", "Me");
  await a().add("Second chapter");
});

describe("exportAudio", () => {
  it("renders every chapter in order and reports the result in the store", async () => {
    await a().exportAudio(options);
    expect(audio.requests.map((r) => r.base)).toEqual([
      "exports/audio/01-chapter-one",
      "exports/audio/02-second-chapter",
    ]);
    expect(audio.requests[0]).toMatchObject({
      voice: "piper-amy",
      speed: 1.1,
      formats: ["opus", "flac"],
    });
    expect(audio.requests[0]!.chunks.length).toBeGreaterThan(0);
    const job = s().audio!;
    expect(job.status).toBe("done");
    expect(job).toMatchObject({ overall: 1, files: 4, durationSec: 180, error: null });
    expect(job.chapters.map((c) => c.state)).toEqual(["done", "done"]);
    expect(s().notice).toContain("exports/audio");
    expect(audio.forgotten).toEqual([audio.requests[0]!.jobId]);
    expect(new Set(audio.requests.map((r) => r.jobId)).size).toBe(1);
  });

  it("shows progress while a chapter renders", async () => {
    const seen: number[] = [];
    audio.render = async (req, onProgress) => {
      onProgress(0.25);
      seen.push(s().audio!.overall);
      return { files: [{ format: "opus", path: `${req.base}.opus` }], durationSec: 1 };
    };
    await a().exportAudio({ ...options, formats: ["opus"] });
    expect(seen[0]).toBeCloseTo(0.125);
  });

  it("keeps the failure in the store, names the chapter and keeps earlier chapters", async () => {
    audio.render = async (req) => {
      if (req.base.includes("02")) throw { kind: "synth", message: "model file is corrupt" };
      return { files: [{ format: "opus", path: `${req.base}.opus` }], durationSec: 5 };
    };
    await a().exportAudio({ ...options, formats: ["opus"] });
    const job = s().audio!;
    expect(job.status).toBe("error");
    expect(job.error).toBeInstanceOf(AudioUiError);
    expect(job.error).toMatchObject({ code: "engine-failed", chapterIndex: 1 });
    expect(job.error!.message).toContain("Chapter 2");
    expect(job.error!.message).toContain("model file is corrupt");
    expect(job.chapters.map((c) => c.state)).toEqual(["done", "failed"]);
    expect(job.files).toBe(1);
    expect(audio.forgotten).toHaveLength(1);
  });

  it("stops promptly on cancel: the engine is told, the result is a cancelled state", async () => {
    let reject: (e: unknown) => void = () => {};
    audio.render = () =>
      new Promise((_, r) => {
        reject = r;
      });
    const cancelling = vi.fn(async (id: string) => {
      audio.cancelled.push(id);
      reject({ kind: "cancelled" });
    });
    const bridge = (await import("../../../lib/bridge")).bridge as unknown as {
      audioCancel: typeof cancelling;
    };
    bridge.audioCancel = cancelling;
    const run = a().exportAudio({ ...options, formats: ["opus"] });
    await vi.waitFor(() => expect(s().audio?.chapters[0]?.state).toBe("rendering"));
    a().cancelAudio();
    expect(s().audio!.cancelling).toBe(true);
    await run;
    expect(audio.cancelled).toEqual([audio.requests[0]!.jobId]);
    expect(s().audio).toMatchObject({ status: "error", error: { code: "cancelled" } });
    expect(audio.requests).toHaveLength(1);
  });

  it("refuses a second export while one runs, and dismiss never clears a running one", async () => {
    let finish: (v: unknown) => void = () => {};
    audio.render = (req) =>
      new Promise((r) => {
        finish = () => r({ files: [{ format: "opus", path: `${req.base}.opus` }], durationSec: 1 });
      });
    const first = a().exportAudio({ ...options, formats: ["opus"] });
    await vi.waitFor(() => expect(s().audio?.status).toBe("running"));
    await expect(a().exportAudio(options)).rejects.toThrow(/already running/);
    a().dismissAudio();
    expect(s().audio?.status).toBe("running");
    audio.render = null;
    finish(null);
    await vi.waitFor(() => expect(audio.requests.length).toBe(2));
    await first;
    expect(s().audio?.status).toBe("done");
    a().dismissAudio();
    expect(s().audio).toBeNull();
  });

  it("reports a missing voice before any chapter is rendered", async () => {
    audio.voices = [{ id: "piper-amy", engine: "piper", installed: false }];
    await a().exportAudio(options);
    expect(audio.requests).toEqual([]);
    expect(s().audio).toMatchObject({ status: "error", error: { code: "voice-missing" } });
  });

  it("rejects bad options as a failed job instead of throwing", async () => {
    await a().exportAudio({ ...options, speed: 5 });
    expect(s().audio).toMatchObject({ status: "error", error: { code: "other" } });
    expect(audio.requests).toEqual([]);
  });

  it("does not read front or back matter", async () => {
    await a().addMatter("front", "title-page");
    await a().addMatter("back", "acknowledgments");
    await a().exportAudio({ ...options, formats: ["opus"] });
    expect(audio.requests).toHaveLength(2);
  });
});

describe("exportAudio chapter selection", () => {
  it("reads only the chosen chapters", async () => {
    const second = s().manifest!.chapters[1]!.id;
    await a().exportAudio({ ...options, formats: ["opus"], chapterIds: [second] });
    expect(audio.requests).toHaveLength(1);
    expect(s().audio!.chapters.map((c) => c.id)).toEqual([second]);
  });
});

describe("hearAudioSample", () => {
  it("renders a few sentences of the first chosen chapter and returns the bytes, writing nothing", async () => {
    const before = new Set(disk.keys());
    const bytes = await a().hearAudioSample({ voice: "piper-amy", speed: 1.1 });
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(audio.samples).toHaveLength(1);
    expect(audio.samples[0]).toMatchObject({ voice: "piper-amy", speed: 1.1 });
    expect(audio.samples[0]!.chunks.length).toBeGreaterThan(0);
    expect(audio.forgotten).toEqual([audio.samples[0]!.jobId]);
    expect(new Set(disk.keys())).toEqual(before);
  });

  it("is null when stopped and a readable error when the engine fails", async () => {
    audio.sample = async () => {
      throw { kind: "cancelled" };
    };
    expect(await a().hearAudioSample({ voice: "piper-amy", speed: 1 })).toBeNull();
    audio.sample = async () => {
      throw { kind: "synth", message: "engine broke" };
    };
    await expect(a().hearAudioSample({ voice: "piper-amy", speed: 1 })).rejects.toThrow(
      /engine broke/,
    );
  });

  it("refuses a second sample while one runs and cancels the running one", async () => {
    let release: (b: Uint8Array) => void = () => {};
    audio.sample = () =>
      new Promise((r) => {
        release = r;
      });
    const first = a().hearAudioSample({ voice: "piper-amy", speed: 1 });
    await vi.waitFor(() => expect(audio.samples).toHaveLength(1));
    await expect(a().hearAudioSample({ voice: "piper-amy", speed: 1 })).rejects.toThrow();
    a().cancelAudioSample();
    expect(audio.cancelled).toEqual([audio.samples[0]!.jobId]);
    release(new Uint8Array([9]));
    await first;
  });
});

describe("exportAudio cache", () => {
  it("reuses unchanged chapters and re-renders when the voice or the files change", async () => {
    await a().exportAudio(options);
    expect(audio.requests).toHaveLength(2);
    a().dismissAudio();
    await a().exportAudio(options);
    expect(audio.requests).toHaveLength(2);
    expect(s().audio).toMatchObject({ status: "done", files: 4, durationSec: 180 });
    a().dismissAudio();
    await a().exportAudio({ ...options, speed: 1 });
    expect(audio.requests).toHaveLength(4);
    a().dismissAudio();
    audio.present.delete("exports/audio/01-chapter-one.opus");
    await a().exportAudio({ ...options, speed: 1 });
    expect(audio.requests).toHaveLength(5);
  });
});

describe("downloadVoices", () => {
  const packs = [
    { id: "piper", bytes: 100 },
    { id: "kokoro", bytes: 300 },
  ];

  it("downloads the packs one after another with progress across all of them", async () => {
    const seen: number[] = [];
    audio.download = async (pack, onProgress) => {
      onProgress({ done: pack === "piper" ? 40 : 150, total: pack === "piper" ? 100 : 300 });
      seen.push(s().voiceDownload!.done);
      onProgress({ done: pack === "piper" ? 100 : 300, total: pack === "piper" ? 100 : 300 });
    };
    await expect(a().downloadVoices(packs)).resolves.toBe(true);
    expect(audio.downloads).toEqual(["piper", "kokoro"]);
    expect(seen).toEqual([40, 250]);
    expect(s().voiceDownload).toBeNull();
    expect(audio.forgotten).toHaveLength(1);
  });

  it("keeps a failure for a retry, with the network message", async () => {
    audio.download = async () => {
      throw { kind: "download", message: "the server answered 503" };
    };
    await expect(a().downloadVoices(packs)).resolves.toBe(false);
    expect(s().voiceDownload).toMatchObject({
      status: "error",
      total: 400,
      error: { code: "download" },
    });
    expect(s().voiceDownload!.error!.message).toContain("503");
    expect(audio.downloads).toEqual(["piper"]);
    a().dismissVoiceDownload();
    expect(s().voiceDownload).toBeNull();
  });

  it("explains a damaged file and a full disk", async () => {
    audio.download = async () => {
      throw { kind: "checksum", file: "model.onnx" };
    };
    await a().downloadVoices(packs);
    expect(s().voiceDownload!.error!.message).toContain("model.onnx");
    audio.download = async () => {
      throw { kind: "disk_full" };
    };
    await a().downloadVoices(packs);
    expect(s().voiceDownload!.error).toMatchObject({ code: "disk-full" });
  });

  it("stops on cancel, tells Rust, and says it was a stop, not a failure", async () => {
    let reject: (e: unknown) => void = () => {};
    audio.download = () =>
      new Promise((_, r) => {
        reject = r;
      });
    const bridge = (await import("../../../lib/bridge")).bridge as unknown as {
      audioCancel: (id: string) => Promise<void>;
    };
    bridge.audioCancel = async (id) => {
      audio.cancelled.push(id);
      reject({ kind: "cancelled" });
    };
    const run = a().downloadVoices(packs);
    await vi.waitFor(() => expect(audio.downloads).toEqual(["piper"]));
    a().cancelVoiceDownload();
    expect(s().voiceDownload!.cancelling).toBe(true);
    await expect(run).resolves.toBe(false);
    expect(audio.cancelled).toHaveLength(1);
    expect(s().voiceDownload).toMatchObject({ status: "error", error: { code: "cancelled" } });
  });

  it("refuses a second download while one runs, and dismiss leaves a running one alone", async () => {
    let finish: () => void = () => {};
    audio.download = () =>
      new Promise((r) => {
        finish = () => r();
      });
    const first = a().downloadVoices([packs[0]!]);
    await vi.waitFor(() => expect(s().voiceDownload?.status).toBe("running"));
    await expect(a().downloadVoices(packs)).rejects.toThrow(/already running/);
    a().dismissVoiceDownload();
    expect(s().voiceDownload?.status).toBe("running");
    finish();
    await expect(first).resolves.toBe(true);
  });
});

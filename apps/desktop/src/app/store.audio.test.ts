import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake bridge: an in-memory project plus a fake audio engine behind the same bridge methods the app uses.
const disk = new Map<string, string>();
const audio = {
  voices: [{ id: "piper-amy", engine: "piper", installed: true }] as { id: string; engine: string; installed: boolean }[],
  requests: [] as { jobId: string; base: string; voice: string; formats: string[]; speed: number; chunks: { text: string }[] }[],
  cancelled: [] as string[],
  forgotten: [] as string[],
  /** Decides what a chapter render does; set per test. */
  render: null as null | ((req: { base: string }, onProgress: (f: number) => void) => Promise<unknown>),
};
const h = (s: string) => `h:${s.length}:${s.slice(0, 40)}`;
vi.mock("../lib/bridge", () => ({
  bridge: {
    createProject: async (_r: string, m: string) => { disk.set("cadabra.json", m); },
    readFile: async (_r: string, p: string) => (disk.has(p) ? { contents: disk.get(p)!, hash: h(disk.get(p)!) } : null),
    writeFile: async (_r: string, p: string, c: string) => { disk.set(p, c); return { hash: h(c), conflict_copy: null }; },
    backupManifest: async () => "backup",
    watchProject: async () => {},
    audioVoices: async () => audio.voices,
    audioRenderChapter: async (req: (typeof audio.requests)[number], onProgress: (f: number) => void) => {
      audio.requests.push(req);
      if (audio.render) return audio.render(req, onProgress);
      onProgress(0.5);
      return { files: req.formats.map((format) => ({ format, path: `${req.base}.${format}` })), durationSec: 90 };
    },
    audioCancel: async (id: string) => { audio.cancelled.push(id); },
    audioForget: async (id: string) => { audio.forgotten.push(id); },
  },
}));

import { AudioUiError } from "../lib/audioErrors";
import { useProject } from "./store";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const options = { voice: "piper-amy", speed: 1.1, formats: ["opus" as const, "flac" as const] };

beforeEach(async () => {
  disk.clear();
  audio.voices = [{ id: "piper-amy", engine: "piper", installed: true }];
  audio.requests = [];
  audio.cancelled = [];
  audio.forgotten = [];
  audio.render = null;
  useProject.setState({ root: null, manifest: null, currentId: null, currentDoc: null, draft: null, hashes: {}, notice: "", reloadCount: 0, exportStage: null, audio: null });
  await a().createProject("/p", "Book", "Me");
  await a().add("Second chapter");
});

describe("exportAudio", () => {
  it("renders every chapter in order and reports the result in the store", async () => {
    await a().exportAudio(options);
    expect(audio.requests.map((r) => r.base)).toEqual(["exports/audio/01-chapter-one", "exports/audio/02-second-chapter"]);
    expect(audio.requests[0]).toMatchObject({ voice: "piper-amy", speed: 1.1, formats: ["opus", "flac"] });
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
    audio.render = () => new Promise((_, r) => { reject = r; });
    const cancelling = vi.fn(async (id: string) => { audio.cancelled.push(id); reject({ kind: "cancelled" }); });
    const bridge = (await import("../lib/bridge")).bridge as unknown as { audioCancel: typeof cancelling };
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
    audio.render = (req) => new Promise((r) => { finish = () => r({ files: [{ format: "opus", path: `${req.base}.opus` }], durationSec: 1 }); });
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

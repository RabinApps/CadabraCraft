import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk, readFile, trashMethods, writeFileWithConflictCopy } from "../../../test/fakeBridge";

const CACHE = ".cadabra/audio/cache.json";
const sw = {
  render: null as
    null | ((req: { base: string; part?: string }, p: (f: number) => void) => Promise<unknown>),
  built: [] as { cover: string | null; chapters: unknown[] }[],
  cancelFails: false,
  cancelled: [] as string[],
  forgetFails: false,
  filesExistFails: false,
  cacheReadFails: false,
  cacheWriteFails: false,
  sample: null as null | (() => Promise<Uint8Array>),
  download: null as null | ((p: (x: { done: number; total: number }) => void) => Promise<void>),
};
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (r: string, p: string) => {
      if (p === CACHE && sw.cacheReadFails) throw new Error("denied");
      return readFile(r, p);
    },
    writeFile: async (r: string, p: string, c: string, b: string | null) => {
      if (p === CACHE && sw.cacheWriteFails) throw new Error("denied");
      return writeFileWithConflictCopy(r, p, c, b);
    },
    ...trashMethods,
    audioVoices: async () => [{ id: "piper-amy", engine: "piper", installed: true }],
    audioRenderChapter: async (
      req: { base: string; formats: string[]; part?: string },
      onProgress: (f: number) => void,
    ) => {
      if (sw.render) return sw.render(req, onProgress);
      return {
        files: req.formats.map((format) => ({ format, path: `${req.base}.${format}` })),
        durationSec: 5,
      };
    },
    audioBuildM4b: async (req: { cover: string | null; chapters: unknown[] }) => {
      sw.built.push(req);
      return { path: "x.m4b", durationSec: 1 };
    },
    audioSample: async () => (sw.sample ? sw.sample() : Uint8Array.of(1)),
    audioFilesExist: async (_r: string, paths: string[]) => {
      if (sw.filesExistFails) throw new Error("ipc");
      return paths.map(() => true);
    },
    audioDownloadPack: async (
      _pack: string,
      _job: string,
      onProgress: (x: { done: number; total: number }) => void,
    ) => (sw.download ? sw.download(onProgress) : undefined),
    audioCancel: async (id: string) => {
      sw.cancelled.push(id);
      if (sw.cancelFails) throw new Error("ipc");
    },
    audioForget: async () => {
      if (sw.forgetFails) throw new Error("ipc");
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const doc = (...content: unknown[]) => ({ type: "doc" as const, content: content as never });
const words = doc({ type: "paragraph", content: [{ type: "text", text: "Hello there." }] });
const imageOnly = doc({ type: "image", attrs: { src: "assets/a.png", alt: "x" } });
const opts = { voice: "piper-amy", speed: 1, formats: ["opus" as const] };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  disk.clear();
  Object.assign(sw, {
    render: null,
    built: [],
    cancelFails: false,
    cancelled: [],
    forgetFails: false,
    filesExistFails: false,
    cacheReadFails: false,
    cacheWriteFails: false,
    sample: null,
    download: null,
  });
  useProject.setState({
    root: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    draft: null,
    activeLanguage: null,
    hashes: {},
    notice: "",
    reloadCount: 0,
    exportStage: null,
    audio: null,
    voiceDownload: null,
  });
  await a().createProject("/p", "Book", "Me");
  await a().saveCurrent(words);
});

/** The open chapter has no text and no title: nothing to read aloud. */
const makeSilent = async () => {
  const m = s().manifest!;
  useProject.setState({
    manifest: { ...m, chapters: [{ ...m.chapters[0]!, titles: { en: "" } }] },
  });
  await a().saveCurrent(imageOnly);
};

const setCover = (cover: string | null) => {
  const m = s().manifest!;
  useProject.setState({
    manifest: { ...m, editions: [{ ...m.editions[0]!, cover }, ...m.editions.slice(1)] },
  });
};

describe("audiobook: nothing to do", () => {
  it("refuses a book without chapters, for the export and for a sample", async () => {
    await a().remove("ch-1");
    await expect(a().exportAudio(opts)).rejects.toThrow(/no chapters to read aloud/);
    await expect(a().hearAudioSample({ voice: "piper-amy", speed: 1 })).rejects.toThrow(
      /no chapters to read aloud/,
    );
  });
  it("a sample of a chapter that is not among the chosen ones has nothing to read", async () => {
    await expect(
      a().hearAudioSample({ voice: "piper-amy", speed: 1, chapterIds: ["other"] }),
    ).rejects.toThrow(/no chapters to read aloud/);
  });
  it("a sample of a chapter without text says so", async () => {
    await makeSilent();
    await expect(a().hearAudioSample({ voice: "piper-amy", speed: 1 })).rejects.toThrow(
      /nothing to read aloud in this chapter/,
    );
  });
  it("a book of chapters without text has no audiobook to build", async () => {
    await makeSilent();
    await a().exportAudio({ ...opts, formats: ["m4b"] });
    expect(s().audio!.status).toBe("error");
    expect(s().audio!.error!.message).toMatch(/nothing to read aloud/);
    expect(s().audio!.chapters[0]!.state).toBe("empty");
  });
});

describe("audiobook: the book file", () => {
  const withPart = async (req: { base: string; part?: string }) => ({
    files: [],
    durationSec: 5,
    part: req.part,
    base: req.base,
  });
  it("gives a PNG or JPEG cover to the book file and leaves any other image out", async () => {
    sw.render = withPart;
    setCover("assets/cover.PNG");
    await a().exportAudio({ ...opts, formats: ["m4b"] });
    expect(sw.built.at(-1)!.cover).toBe("assets/cover.PNG");
    setCover("assets/cover.webp");
    useProject.setState({ audio: null });
    await a().exportAudio({ ...opts, formats: ["m4b"] });
    expect(sw.built.at(-1)!.cover).toBeNull();
    setCover(null);
    useProject.setState({ audio: null });
    await a().exportAudio({ ...opts, formats: ["m4b"] });
    expect(sw.built.at(-1)!.cover).toBeNull();
    expect(s().audio!.status).toBe("done");
  });
  it("tells the engine to stop at once when Cancel came before the book file was started", async () => {
    sw.render = async (req) => {
      a().cancelAudio(); // pressed during the last chapter, which still finishes
      return withPart(req);
    };
    await a().exportAudio({ ...opts, formats: ["m4b"] });
    expect(sw.cancelled.length).toBe(2); // once for the chapter's render, once for the book file
  });
  it("ignores a failing cancel while packing", async () => {
    sw.render = async (req) => {
      a().cancelAudio();
      return withPart(req);
    };
    sw.cancelFails = true;
    await a().exportAudio({ ...opts, formats: ["m4b"] });
    await tick();
    expect(sw.cancelled.length).toBe(2);
  });
});

describe("audiobook: cache and housekeeping", () => {
  it("renders again when the cache is damaged, not an object, or its files cannot be checked", async () => {
    disk.set(CACHE, "{broken");
    await a().exportAudio(opts);
    await tick();
    disk.set(CACHE, "[]");
    await a().exportAudio(opts);
    await tick();
    expect(JSON.parse(disk.get(CACHE)!)).toHaveProperty("en:ch-1");
    sw.filesExistFails = true;
    let renders = 0;
    sw.render = async (req) => {
      renders++;
      return { files: [{ format: "opus", path: `${req.base}.opus` }], durationSec: 5 };
    };
    await a().exportAudio(opts);
    expect(renders).toBe(1);
  });
  it("still finishes when the cache cannot be read or written, or the engine cannot forget the job", async () => {
    sw.cacheReadFails = true;
    sw.cacheWriteFails = true;
    sw.forgetFails = true;
    await a().exportAudio(opts);
    await tick();
    expect(s().audio!.status).toBe("done");
  });
  it("a chapter with nothing to read is shown as empty and is not cached", async () => {
    await makeSilent();
    await a().exportAudio(opts);
    expect(s().audio!.chapters[0]!.state).toBe("empty");
    expect(disk.has(CACHE)).toBe(false);
  });
  it("keeps going when the job state was cleared while it ran", async () => {
    sw.render = async (req, onProgress) => {
      useProject.setState({ audio: null });
      onProgress(0.5);
      a().cancelAudio(); // nothing to mark as cancelling
      return { files: [], durationSec: 1, req };
    };
    await a().exportAudio(opts);
    expect(s().audio).toBeNull();
  });
  it("ignores Cancel when nothing is running", () => {
    expect(() => a().cancelAudio()).not.toThrow();
    expect(() => a().cancelAudioSample()).not.toThrow();
  });
});

describe("audio sample, rare paths", () => {
  it("ignores a failing cancel and a failing forget", async () => {
    let release = () => {};
    sw.sample = () => new Promise((r) => (release = () => r(Uint8Array.of(1))));
    sw.cancelFails = true;
    sw.forgetFails = true;
    const p = a().hearAudioSample({ voice: "piper-amy", speed: 1 });
    await tick();
    a().cancelAudioSample();
    release();
    expect(await p).toEqual(Uint8Array.of(1));
    await tick();
    expect(sw.cancelled.length).toBe(1);
  });
});

describe("voice downloads, rare paths", () => {
  it("ignores progress that arrives after the state was cleared, and a failing forget", async () => {
    sw.forgetFails = true;
    sw.download = async (onProgress) => {
      useProject.setState({ voiceDownload: null });
      onProgress({ done: 1, total: 2 });
    };
    expect(await a().downloadVoices([{ id: "p", bytes: 2 }])).toBe(true);
    await tick();
    expect(s().voiceDownload).toBeNull();
  });
  it("stops a running download, tolerating a failing cancel, and ignores Cancel otherwise", async () => {
    expect(() => a().cancelVoiceDownload()).not.toThrow();
    let release = () => {};
    sw.download = () => new Promise<void>((r) => (release = r));
    sw.cancelFails = true;
    const p = a().downloadVoices([{ id: "p", bytes: 2 }]);
    await tick();
    a().cancelVoiceDownload();
    expect(s().voiceDownload!.cancelling).toBe(true);
    release();
    await p;
    await tick();
    expect(sw.cancelled.length).toBe(1);
  });
  it("cancelling after the state was cleared marks nothing", async () => {
    let release = () => {};
    sw.download = () => new Promise<void>((r) => (release = r));
    const p = a().downloadVoices([{ id: "p", bytes: 2 }]);
    await tick();
    useProject.setState({ voiceDownload: null });
    a().cancelVoiceDownload();
    expect(s().voiceDownload).toBeNull();
    release();
    await p;
  });
});

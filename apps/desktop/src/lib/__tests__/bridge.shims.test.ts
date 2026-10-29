import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class Channel<T> {
    onmessage: (v: T) => void = () => {};
  }
  return {
    invoke: vi.fn(),
    Channel,
    listen: vi.fn(),
    openUrl: vi.fn(),
    relaunch: vi.fn(),
    check: vi.fn(),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: m.invoke, Channel: m.Channel }));
vi.mock("@tauri-apps/api/event", () => ({ listen: m.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: m.openUrl }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: m.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: m.check }));

import { bridge } from "../bridge";

beforeEach(() => {
  for (const f of [m.invoke, m.listen, m.openUrl, m.relaunch, m.check]) f.mockReset();
});

/** Calls `fn`, answering the invoke with `answer`, and returns [command, args]. */
async function sent(fn: () => unknown, answer: unknown = null) {
  m.invoke.mockResolvedValueOnce(answer);
  await fn();
  return m.invoke.mock.calls[0]!;
}

describe("project commands", () => {
  const cases: [string, () => unknown, string, unknown][] = [
    [
      "createProject",
      () => bridge.createProject("/r", "{}"),
      "create_project",
      { root: "/r", manifestJson: "{}" },
    ],
    [
      "readFile",
      () => bridge.readFile("/r", "a.json"),
      "read_project_file",
      { root: "/r", path: "a.json" },
    ],
    [
      "writeFile",
      () => bridge.writeFile("/r", "a.json", "x", "h"),
      "write_project_file",
      { root: "/r", path: "a.json", contents: "x", baseHash: "h" },
    ],
    ["backupManifest", () => bridge.backupManifest("/r"), "backup_manifest", { root: "/r" }],
    [
      "trashFile",
      () => bridge.trashFile("/r", "a.json"),
      "trash_project_file",
      { root: "/r", path: "a.json" },
    ],
    ["listTrash", () => bridge.listTrash("/r"), "list_project_trash", { root: "/r" }],
    [
      "restoreTrash",
      () => bridge.restoreTrash("/r", "t"),
      "restore_project_trash",
      { root: "/r", path: "t" },
    ],
    [
      "listSnapshots",
      () => bridge.listSnapshots("/r", "a"),
      "list_page_snapshots",
      { root: "/r", path: "a" },
    ],
    [
      "readSnapshot",
      () => bridge.readSnapshot("/r", "a", "s"),
      "read_page_snapshot",
      { root: "/r", path: "a", snapshot: "s" },
    ],
    [
      "restoreSnapshot",
      () => bridge.restoreSnapshot("/r", "a", "s"),
      "restore_page_snapshot",
      { root: "/r", path: "a", snapshot: "s" },
    ],
    [
      "pruneSnapshots",
      () => bridge.pruneSnapshots("/r", ["a"], 5),
      "prune_page_snapshots",
      { root: "/r", paths: ["a"], keep: 5 },
    ],
    [
      "findStalePages",
      () => bridge.findStalePages("/r", ["a"]),
      "find_stale_pages",
      { root: "/r", paths: ["a"] },
    ],
  ];
  it.each(cases)("%s invokes its command", async (_n, fn, cmd, args) => {
    expect(await sent(fn)).toEqual([cmd, args]);
  });
});

describe("asset commands", () => {
  it("importAsset", async () => {
    expect(await sent(() => bridge.importAsset("/r", "/img.png"))).toEqual([
      "import_asset",
      { root: "/r", source: "/img.png" },
    ]);
  });
  it("readImportSource converts the bytes", async () => {
    m.invoke.mockResolvedValueOnce([1, 2]);
    expect(await bridge.readImportSource("/doc.md")).toEqual(Uint8Array.of(1, 2));
    expect(m.invoke).toHaveBeenCalledWith("read_import_source", { path: "/doc.md" });
  });
  it("readImportImage converts the bytes", async () => {
    m.invoke.mockResolvedValueOnce([3]);
    expect(await bridge.readImportImage("/doc.md", "a.png")).toEqual(Uint8Array.of(3));
    expect(m.invoke).toHaveBeenCalledWith("read_import_image", {
      sourceFile: "/doc.md",
      reference: "a.png",
    });
  });
  it("importAssetBytes sends the bytes as a plain array", async () => {
    expect(await sent(() => bridge.importAssetBytes("/r", "a.png", Uint8Array.of(7, 8)))).toEqual([
      "import_asset_bytes",
      { root: "/r", name: "a.png", bytes: [7, 8] },
    ]);
  });
});

describe("export commands", () => {
  it("typstFind", async () => {
    expect(await sent(() => bridge.typstFind())).toEqual(["typst_find"]);
  });
  it("typstListFonts", async () => {
    expect(await sent(() => bridge.typstListFonts())).toEqual(["typst_list_fonts"]);
  });
});

describe("system commands", () => {
  it("openUrl, checkForUpdate and relaunch go to their plugins", async () => {
    m.openUrl.mockResolvedValueOnce(undefined);
    await bridge.openUrl("https://x.test");
    expect(m.openUrl).toHaveBeenCalledWith("https://x.test");
    m.check.mockResolvedValueOnce(null);
    expect(await bridge.checkForUpdate()).toBeNull();
    m.relaunch.mockResolvedValueOnce(undefined);
    await bridge.relaunch();
    expect(m.relaunch).toHaveBeenCalled();
  });
  it("updatesSupported", async () => {
    expect(await sent(() => bridge.updatesSupported(), true)).toEqual(["updates_supported"]);
  });
});

describe("watch commands", () => {
  it("watchProject", async () => {
    expect(await sent(() => bridge.watchProject("/r"))).toEqual(["watch_project", { root: "/r" }]);
  });
  it("onProjectChanged passes the payload and resolves to the unsubscribe function", async () => {
    const un = vi.fn();
    m.listen.mockResolvedValueOnce(un);
    const cb = vi.fn();
    expect(await bridge.onProjectChanged(cb)).toBe(un);
    const [event, handler] = m.listen.mock.calls[0]!;
    expect(event).toBe("project-changed");
    handler({ payload: "chapters/a.json" });
    expect(cb).toHaveBeenCalledWith("chapters/a.json");
  });
});

describe("audio commands", () => {
  it("plain commands", async () => {
    const cases: [() => unknown, string, unknown][] = [
      [() => bridge.audioVoices(), "audio_voices", undefined],
      [() => bridge.audioPacks(), "audio_packs", undefined],
      [() => bridge.audioDeletePack("p"), "audio_delete_pack", { pack: "p" }],
      [() => bridge.audioCancel("j"), "audio_cancel", { jobId: "j" }],
      [() => bridge.audioForget("j"), "audio_forget", { jobId: "j" }],
      [
        () => bridge.audioFilesExist("/r", ["a"]),
        "audio_files_exist",
        { root: "/r", paths: ["a"] },
      ],
    ];
    for (const [fn, cmd, args] of cases) {
      m.invoke.mockReset();
      expect(await sent(fn)).toEqual(args === undefined ? [cmd] : [cmd, args]);
    }
  });
  it("audioBuildM4b and audioSample", async () => {
    const req = {
      jobId: "j",
      root: "/r",
      base: "b",
      title: "t",
      author: "a",
      cover: null,
      chapters: [],
    };
    expect(await sent(() => bridge.audioBuildM4b(req))).toEqual([
      "audio_build_m4b",
      { request: req },
    ]);
    m.invoke.mockReset();
    m.invoke.mockResolvedValueOnce([5]);
    const sample = { jobId: "j", chunks: [], voice: "v", speed: 1 };
    expect(await bridge.audioSample(sample)).toEqual(Uint8Array.of(5));
    expect(m.invoke).toHaveBeenCalledWith("audio_sample", { request: sample });
  });
  it("audioRenderChapter forwards progress through a channel", async () => {
    m.invoke.mockResolvedValueOnce({ ok: true });
    const onProgress = vi.fn();
    const request = { jobId: "j" } as never;
    expect(await bridge.audioRenderChapter(request, onProgress)).toEqual({ ok: true });
    const [cmd, args] = m.invoke.mock.calls[0]!;
    expect(cmd).toBe("audio_render_chapter");
    expect(args.request).toBe(request);
    args.onProgress.onmessage(0.5);
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });
  it("audioDownloadPack forwards progress through a channel", async () => {
    m.invoke.mockResolvedValueOnce(undefined);
    const onProgress = vi.fn();
    await bridge.audioDownloadPack("p", "j", onProgress);
    const [cmd, args] = m.invoke.mock.calls[0]!;
    expect(cmd).toBe("audio_download_pack");
    expect(args).toMatchObject({ pack: "p", jobId: "j" });
    args.onProgress.onmessage({ done: 1, total: 2 });
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 2 });
  });
});

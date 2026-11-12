import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { audioBridge } from "../bridge/audio";
import { epubcheckBridge } from "../bridge/epubcheck";

beforeEach(() => invoke.mockReset().mockResolvedValue(null));

describe("EPUBCheck commands", () => {
  it("find, validate and cancel call their commands", async () => {
    await epubcheckBridge.epubcheckFind();
    await epubcheckBridge.epubcheckValidate("/book", "exports/book.epub");
    await epubcheckBridge.epubcheckCancel();
    expect(invoke.mock.calls).toEqual([
      ["epubcheck_find"],
      ["epubcheck_validate", { root: "/book", path: "exports/book.epub" }],
      ["epubcheck_cancel"],
    ]);
  });
});

describe("audio transcript command", () => {
  it("writes a transcript under the book folder", async () => {
    await audioBridge.audioWriteTranscript("/book", "exports/audio/a.vtt", "WEBVTT");
    expect(invoke).toHaveBeenCalledWith("audio_write_transcript", {
      root: "/book",
      path: "exports/audio/a.vtt",
      contents: "WEBVTT",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  AudioTimeoutError,
  CancelledError,
  ChapterRenderError,
  ChecksumError,
  DiskFullError,
  DownloadError,
  EncodeError,
  EngineNotFoundError,
  SynthesisError,
  VoiceNotInstalledError,
} from "@cadabracraft/export-audio";
import { AudioUiError, describeAudioError } from "../audioErrors";

describe("describeAudioError", () => {
  const cases: [string, Error, string, RegExp][] = [
    [
      "voice",
      new VoiceNotInstalledError("amy"),
      "voice-missing",
      /^The voice "amy" is not installed/,
    ],
    ["engine", new EngineNotFoundError("/x"), "engine-missing", /Reinstall the app/],
    ["synthesis", new SynthesisError(" boom \n"), "engine-failed", /stopped:\nboom$/],
    ["encode", new EncodeError("flac", " bad "), "encode", /^FLAC could not be written:\nbad$/],
    ["download", new DownloadError("offline"), "download", /download failed: offline/],
    ["checksum", new ChecksumError("a.onnx"), "download", /a\.onnx was damaged/],
    ["disk", new DiskFullError(), "disk-full", /not enough disk space/],
    ["timeout", new AudioTimeoutError(30), "timeout", /longer than 30 seconds/],
    ["other", new Error("weird"), "other", /^Weird$/],
  ];
  it.each(cases)("maps %s with an upper-cased first letter", (_n, err, code, text) => {
    const r = describeAudioError(err);
    expect(r).toBeInstanceOf(AudioUiError);
    expect(r.code).toBe(code);
    expect(r.message).toMatch(text);
    expect(r.chapterIndex).toBeUndefined();
    expect(r.cause).toBe(err);
  });

  it("returns an AudioUiError unchanged", () => {
    const e = new AudioUiError("other", "x");
    expect(describeAudioError(e)).toBe(e);
  });

  it("maps a cancel", () => {
    const r = describeAudioError(new CancelledError());
    expect(r.code).toBe("cancelled");
    expect(r.message).toContain("cancelled");
  });

  it("names the chapter that stopped, one-based, and keeps the reason's code", () => {
    const r = describeAudioError(new ChapterRenderError(1, "Dawn", new DiskFullError()));
    expect(r.code).toBe("disk-full");
    expect(r.chapterIndex).toBe(1);
    expect(r.message).toMatch(/Chapter 2, Dawn, stopped: there is not enough disk space/);
  });

  it("a cancel inside a chapter is a plain cancel", () => {
    const r = describeAudioError(new ChapterRenderError(0, "A", new CancelledError()));
    expect(r.code).toBe("cancelled");
    expect(r.chapterIndex).toBeUndefined();
  });
});

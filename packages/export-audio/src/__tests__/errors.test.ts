import { describe, expect, it } from "vitest";
import {
  AudioExportError,
  AudioTimeoutError,
  CancelledError,
  ChapterRenderError,
  ChecksumError,
  DiskFullError,
  DownloadError,
  EncodeError,
  EngineNotFoundError,
  SynthesisError,
  UnsupportedNodeError,
  VoiceNotInstalledError,
} from "../errors";

describe("audio export errors", () => {
  it("each one names what went wrong and keeps its details", () => {
    const e1 = new UnsupportedNodeError("mystery");
    expect(e1.nodeType).toBe("mystery");
    expect(e1.message).toContain('"mystery"');

    const e2 = new VoiceNotInstalledError("af_heart");
    expect(e2.voice).toBe("af_heart");
    expect(e2.message).toContain("af_heart");

    expect(new EngineNotFoundError("/opt/engine").message).toContain("/opt/engine");

    const e4 = new SynthesisError("  crashed \n");
    expect(e4.detail).toBe("  crashed \n");
    expect(e4.message).toBe("The voice engine failed:\ncrashed");

    const e5 = new EncodeError("mp3", " no encoder\n");
    expect([e5.format, e5.detail]).toEqual(["mp3", " no encoder\n"]);
    expect(e5.message).toBe("Could not write MP3:\nno encoder");

    const e6 = new AudioTimeoutError(30);
    expect(e6.seconds).toBe(30);
    expect(e6.message).toContain("30 seconds");

    expect(new DiskFullError().message).toContain("disk space");

    const e8 = new DownloadError("offline");
    expect(e8.detail).toBe("offline");
    expect(e8.message).toContain("offline");

    const e9 = new ChecksumError("model.onnx");
    expect(e9.file).toBe("model.onnx");
    expect(e9.message).toContain("model.onnx");

    expect(new CancelledError().message).toContain("cancelled");
  });

  it("is an AudioExportError with its own name", () => {
    for (const e of [
      new UnsupportedNodeError("x"),
      new VoiceNotInstalledError("v"),
      new EngineNotFoundError("p"),
      new SynthesisError("d"),
      new EncodeError("m4b", "d"),
      new AudioTimeoutError(1),
      new DiskFullError(),
      new DownloadError("d"),
      new ChecksumError("f"),
      new CancelledError(),
    ]) {
      expect(e).toBeInstanceOf(AudioExportError);
      expect(e.name).toBe(e.constructor.name);
    }
  });

  it("wraps the cause of a failed chapter with its position", () => {
    const cause = new DiskFullError();
    const e = new ChapterRenderError(1, "Two", cause);
    expect([e.chapterIndex, e.chapterTitle, e.cause]).toEqual([1, "Two", cause]);
    expect(e.message).toBe(`Chapter 2, Two: ${cause.message}`);
  });
});

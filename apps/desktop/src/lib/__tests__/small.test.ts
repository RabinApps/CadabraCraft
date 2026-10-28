import { describe, expect, it } from "vitest";
import { AUDIO_FORMATS, defaultVoice, mb, toggleAudioFormat } from "../audioFormats";
import { baseName, stem } from "../paths";
import { trimLabel } from "../trimLabels";

describe("paths", () => {
  it("takes the last part whichever separator is used", () => {
    expect(baseName("/a/b/c.md")).toBe("c.md");
    expect(baseName("C:\\a\\b.docx")).toBe("b.docx");
    expect(baseName("plain.txt")).toBe("plain.txt");
    expect(baseName("dir/")).toBe("");
  });
  it("stem drops only the last extension", () => {
    expect(stem("a.b.md")).toBe("a.b");
    expect(stem("noext")).toBe("noext");
  });
});

describe("trimLabel", () => {
  it("shows inches", () => {
    expect(trimLabel("5.5x8.5")).toBe("5.5 × 8.5 in");
  });
});

describe("audio formats", () => {
  it("picks the first installed voice, or none", () => {
    const v = (id: string, installed: boolean) => ({ id, installed }) as never;
    expect(defaultVoice([v("a", false), v("b", true), v("c", true)])).toBe("b");
    expect(defaultVoice([v("a", false)])).toBe("");
    expect(defaultVoice([])).toBe("");
  });
  it("shows megabytes, at least one", () => {
    expect(mb(0)).toBe(1);
    expect(mb(2_600_000)).toBe(3);
  });
  it("toggles in display order and never leaves none", () => {
    expect(toggleAudioFormat(["opus"], "wav", true)).toEqual(["opus", "wav"]);
    expect(toggleAudioFormat(["m4b", "opus"], "flac", true)).toEqual(["opus", "flac", "m4b"]);
    expect(toggleAudioFormat(["opus", "wav"], "opus", false)).toEqual(["wav"]);
    expect(toggleAudioFormat(["opus"], "opus", false)).toBeNull();
    expect(AUDIO_FORMATS).toContain("m4b");
  });
});

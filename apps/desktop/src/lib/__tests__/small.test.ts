import { describe, expect, it } from "vitest";
import {
  AUDIO_FORMATS,
  defaultVoice,
  mb,
  primaryLanguage,
  toggleAudioFormat,
  voicesFor,
} from "../audio/audioFormats";
import { baseName, stem } from "../paths";
import { trimLabel } from "../export/trimLabels";

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
  it("picks the first installed voice that reads the language, or none", () => {
    const v = (id: string, installed: boolean, languages = ["en"]) =>
      ({ id, installed, languages }) as never;
    expect(defaultVoice([v("a", false), v("b", true), v("c", true)], "en")).toBe("b");
    expect(defaultVoice([v("a", false)], "en")).toBe("");
    expect(defaultVoice([], "en")).toBe("");
    expect(defaultVoice([v("a", true), v("fr", true, ["fr"])], "fr-CA")).toBe("fr");
    expect(defaultVoice([v("a", true)], "fr")).toBe("");
  });
  it("lists voices by the primary language subtag", () => {
    expect(primaryLanguage("pt-BR")).toBe("pt");
    expect(primaryLanguage("EN")).toBe("en");
    const v = { id: "a", installed: true, languages: ["en"] } as never;
    expect(voicesFor([v], "en-GB")).toHaveLength(1);
    expect(voicesFor([v], "he")).toHaveLength(0);
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

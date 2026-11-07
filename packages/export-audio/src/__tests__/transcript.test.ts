import { describe, expect, it } from "vitest";
import { chunkBlocks } from "../chunk";
import { narrate } from "../narrate";
import { chapterVtt, cueTimes, plainTranscript, vttTime } from "../transcript";
import type { ChapterDoc } from "@cadabracraft/shared";

const doc: ChapterDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "The quay was empty. A gull cried." }] },
    { type: "sceneBreak" },
    { type: "paragraph", content: [{ type: "text", text: "Tom & Jerry <left>." }] },
  ],
};
const chunks = chunkBlocks(narrate(doc, "The Quay").blocks);
const chapter = { title: "The Quay", chunks, durationSec: 12 };

describe("plainTranscript", () => {
  it("uses the text the voice was given, with the chapter title first and scene breaks marked", () => {
    expect(plainTranscript("My Book", [chapter])).toBe(
      "My Book\n\n\nThe Quay\n\nThe quay was empty. A gull cried.\n\n* * *\n\nTom & Jerry <left>.\n",
    );
  });

  it("joins chunks of one paragraph and skips chapters with nothing to read", () => {
    const long = [
      { text: "One.", pauseAfterMs: 250 },
      { text: "Two.", pauseAfterMs: 600 },
    ];
    const text = plainTranscript("B", [
      { title: "Empty", chunks: [], durationSec: 0 },
      { title: "X", chunks: long, durationSec: 1 },
    ]);
    expect(text).toBe("B\n\n\nOne. Two.\n");
  });
});

describe("plainTranscript, a chapter that ends mid-paragraph", () => {
  it("keeps the last words when no paragraph pause follows them", () => {
    const tail = [
      { text: "One.", pauseAfterMs: 600 },
      { text: "Trailing words.", pauseAfterMs: 250 },
    ];
    expect(plainTranscript("B", [{ title: "X", chunks: tail, durationSec: 1 }])).toBe(
      "B\n\n\nOne.\n\nTrailing words.\n",
    );
  });
});

describe("WebVTT", () => {
  it("formats timestamps with hours and milliseconds", () => {
    expect(vttTime(0)).toBe("00:00:00.000");
    expect(vttTime(3723.4567)).toBe("01:02:03.457");
    expect(vttTime(-5)).toBe("00:00:00.000");
  });

  it("has one ordered cue per chunk that ends inside the audio, with the text escaped", () => {
    const times = cueTimes(chapter);
    expect(times).toHaveLength(chunks.length);
    expect(times[0]!.start).toBe(0);
    times.forEach((t, i) => {
      expect(t.end).toBeGreaterThan(t.start);
      if (i > 0) expect(t.start).toBeGreaterThanOrEqual(times[i - 1]!.end);
    });
    expect(times.at(-1)!.end).toBeLessThanOrEqual(12);
    const vtt = chapterVtt(chapter, "fr-CA");
    expect(vtt.startsWith("WEBVTT\nLanguage: fr-CA\n\nNOTE ")).toBe(true);
    expect(vtt.match(/ --> /g)).toHaveLength(chunks.length);
    expect(vtt).toContain("Tom &amp; Jerry &lt;left&gt;.");
    expect(vtt).toContain("\n1\n00:00:00.000 --> ");
  });

  it("leaves a malformed language out of the header and gives no times to a silent chapter", () => {
    expect(chapterVtt(chapter, "fr\nNOTE x")).toMatch(/^WEBVTT\n\nNOTE /);
    expect(cueTimes({ title: "x", chunks, durationSec: 0 }).every((t) => t.end === 0)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { MAX_SPEECH_CHARS, splitSentences } from "../sentences";

const texts = (s: string, max?: number) =>
  splitSentences(s, max).map((r) => s.slice(r.start, r.end));

describe("splitSentences", () => {
  it("splits at . ! ? and the ellipsis, keeping the closing quote with its sentence", () => {
    expect(texts('He ran. She stayed! Why? "Wait…" he said.')).toEqual([
      "He ran.",
      "She stayed!",
      "Why?",
      '"Wait…"',
      "he said.",
    ]);
  });

  it("keeps a run of punctuation with the sentence it ends", () => {
    expect(texts("Wait... what?!")).toEqual(["Wait...", "what?!"]);
  });

  it("reads text with no sentence punctuation as one sentence", () => {
    expect(texts("A heading with no full stop")).toEqual(["A heading with no full stop"]);
  });

  it("trims white space and skips empty or punctuation-only text", () => {
    expect(texts("   ")).toEqual([]);
    expect(texts("  One.   Two.  ")).toEqual(["One.", "Two."]);
  });

  it("cuts a sentence longer than the limit at a space, never inside it when a space is near", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const parts = texts(long, 60);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(60);
    expect(parts.join(" ")).toBe(long);
  });

  it("cuts an unbroken run of characters at the limit", () => {
    const run = "x".repeat(25);
    expect(texts(run, 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("uses the default limit when none is given", () => {
    const parts = texts("y".repeat(MAX_SPEECH_CHARS + 1));
    expect(parts.map((p) => p.length)).toEqual([MAX_SPEECH_CHARS, 1]);
  });
});

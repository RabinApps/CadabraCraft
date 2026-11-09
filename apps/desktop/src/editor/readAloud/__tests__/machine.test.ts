import { describe, expect, it } from "vitest";
import { advance, indexAtCursor, pause, resume, start, STOPPED, type ReadState } from "../machine";

const reading = (index: number): ReadState => ({ status: "reading", index });

describe("read-aloud state machine", () => {
  it("starts at a sentence when there is one, and stays stopped when there is nothing to read", () => {
    expect(start(3, 0)).toEqual(reading(0));
    expect(start(3, 2)).toEqual(reading(2));
    expect(start(3, 3)).toEqual(STOPPED);
    expect(start(0, 0)).toEqual(STOPPED);
    expect(start(3, -1)).toEqual(STOPPED);
  });

  it("advances one sentence at a time and stops after the last one", () => {
    let s = start(2, 0);
    s = advance(s, 2);
    expect(s).toEqual(reading(1));
    expect(advance(s, 2)).toEqual(STOPPED);
  });

  it("does nothing to a stopped reader", () => {
    expect(advance(STOPPED, 5)).toEqual(STOPPED);
  });

  it("pauses and resumes without moving the sentence", () => {
    const paused = pause(reading(4));
    expect(paused).toEqual({ status: "paused", index: 4 });
    expect(resume(paused)).toEqual(reading(4));
  });

  it("ignores pause when not reading and resume when not paused", () => {
    expect(pause(STOPPED)).toEqual(STOPPED);
    expect(resume(reading(1))).toEqual(reading(1));
  });

  it("finds the sentence the cursor is in, or the first one after it", () => {
    const sentences = [{ to: 10 }, { to: 20 }, { to: 30 }];
    expect(indexAtCursor(sentences, 0)).toBe(0);
    expect(indexAtCursor(sentences, 9)).toBe(0);
    expect(indexAtCursor(sentences, 10)).toBe(1);
    expect(indexAtCursor(sentences, 25)).toBe(2);
    expect(indexAtCursor(sentences, 30)).toBe(-1);
    expect(indexAtCursor([], 5)).toBe(-1);
  });
});
